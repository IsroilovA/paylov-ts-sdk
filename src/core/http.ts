/** Transport: URL construction, deadlines, abort, metadata logging, GET-only retries, 401 replay. */

import { setTimeout as delay } from 'node:timers/promises';

import { decodePayload, type DecodedPayload, type Decoder } from './decoding.js';
import { endpointName, responseContext } from './endpoint.js';
import { normalizeResponse, type NormalizedFailure } from './envelope.js';
import type { PaylovErrorCode } from './errorCodes.js';
import {
  abortedError,
  attemptFailure,
  beforeOperation,
  clientClosedError,
  invalidInput,
  isPaylovApiError,
  type PaylovClientClosedError,
  type PaylovConnectionError,
} from './errors.js';
import { raceAbort, untilAborted, type ClientLifecycle } from './lifecycle.js';
import type {
  AuthorizationContext,
  AuthProvider,
  Endpoint,
  EndpointEffect,
  FetchLike,
  HttpClient,
  PaylovHttpMethod,
  PaylovLogger,
  PaylovTransportConfig,
  RequestOptions,
  ResponseContext,
  ResponseShape,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
/** The default of `maxGetRetries`. */
const DEFAULT_GET_RETRIES = 2;
/** The bound of `maxGetRetries`: a longer burst only spends the gateway's patience. */
export const MAX_GET_RETRIES = 5;
const BASE_DELAY_MS = 200;
/**
 * Transient gateway failures. 429 is excluded: the token endpoint asks for tens of seconds
 * (`retryAfterSeconds`), which a sub-second backoff would only spend against the same window.
 */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504]);
const RATE_LIMITED = 429;

/** Whether a GET that received `httpStatus` is retried. */
export function isRetryableStatus(httpStatus: number): boolean {
  return RETRYABLE_STATUSES.has(httpStatus);
}

export interface HttpClientConfig extends PaylovTransportConfig {
  /** A bare origin, already validated by the surface's configuration. */
  readonly origin: string;
  /** Supplies Bearer headers and enables the single 401 replay. */
  readonly auth?: AuthProvider;
  readonly lifecycle?: ClientLifecycle;
  /** Test seams for deterministic backoff and jitter; not in any public configuration. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

function noop(): void {
  // Swallows a rejection nobody awaits.
}

/** A logger, sync or async, must never delay or fail a request. */
function callHookSafely(run: () => void | Promise<void>): void {
  void Promise.try(run).catch(noop);
}

/** Opens one logged attempt; the returned function closes it. */
function logAttempt(
  logger: PaylovLogger | undefined,
  method: PaylovHttpMethod,
  endpoint: string,
  attempt: number,
): (httpStatus: number, errorCode: string | undefined) => void {
  const event = { method, endpoint, attempt };
  if (logger?.onRequest !== undefined) callHookSafely(() => logger.onRequest?.(event));
  const startedAt = Date.now();
  return (httpStatus, errorCode) => {
    if (logger?.onResponse === undefined) return;
    const response = {
      ...event,
      httpStatus,
      durationMs: Date.now() - startedAt,
      ...(errorCode !== undefined ? { errorCode } : {}),
    };
    callHookSafely(() => logger.onResponse?.(response));
  };
}

/** Rejects a lone surrogate before `encodeURIComponent` throws an unwrapped native error. */
function encodeComponent(value: string, field: string): string {
  if (!value.isWellFormed()) {
    throw invalidInput(`${field} must contain well-formed Unicode`, field, 'format');
  }
  return encodeURIComponent(value);
}

/** Keeps an identifier inside one path segment; URL parsers normalize even encoded dot segments. */
function encodePathSegment(value: string, field: string): string {
  if (value === '.' || value === '..') {
    throw invalidInput(`${field} must not be a dot path segment`, field, 'format');
  }
  return encodeComponent(value, field);
}

/** The route with each `{name}` filled; failures name the placeholder, the SDK parameter. */
function fillRoute(route: string, values: Readonly<Record<string, string>> = {}): string {
  let path = route;
  for (const [name, value] of Object.entries(values)) {
    const segment = encodePathSegment(value, name);
    path = path.replace(`{${name}}`, () => segment);
  }
  return path;
}

function buildUrl(origin: string, route: string, options: RequestOptions): string {
  const path = fillRoute(route, options.path);
  const pairs = Object.entries(options.query ?? {}).flatMap(([key, value]) =>
    value === undefined
      ? []
      : [`${encodeURIComponent(key)}=${encodeComponent(String(value), key)}`],
  );
  return pairs.length > 0 ? `${origin}${path}?${pairs.join('&')}` : `${origin}${path}`;
}

function requestHeaders(
  custom: Readonly<Record<string, string>> = {},
  hasBody: boolean,
): Record<string, string> {
  return {
    accept: 'application/json',
    ...custom,
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
  };
}

/** Unparseable bodies become `undefined`; the normalizer classifies them by status. */
async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, undefined, signal === undefined ? {} : { signal });
}

function failureCode(
  callerSignal: AbortSignal | undefined,
  timeout: AbortSignal,
): PaylovConnectionError['code'] {
  if (callerSignal?.aborted === true) return 'sdk_aborted';
  return timeout.aborted ? 'sdk_timeout' : 'sdk_network_error';
}

interface Failed {
  readonly kind: 'failed';
  readonly failure: PaylovConnectionError;
}

interface Received {
  readonly kind: 'received';
  readonly response: Response;
  readonly body: unknown;
}

/** What a received response answers the call: the decoded value, or the error it settles with. */
type Answer<T> = DecodedPayload<T> | NormalizedFailure;

/** A received exchange read against its endpoint, with the credentials it carried. */
interface ReceivedAttempt<T> {
  readonly kind: 'received';
  readonly context: ResponseContext;
  readonly answer: Answer<T>;
  readonly authorization: AuthorizationContext | undefined;
}

type Exchange = Received | Failed;
type Attempt<T> = ReceivedAttempt<T> | Failed;

/** Where the endpoint's decoder starts, as decode failures report it. */
function decodeRoot(shape: ResponseShape): string {
  return shape === 'envelope' ? 'result' : 'body';
}

/**
 * A received response read through the endpoint's decoder, and the code its response event
 * reports. A miss decoded from a success body is a successful exchange, so its event has no code.
 */
function readAnswer<T>(
  endpoint: Endpoint,
  context: ResponseContext,
  body: unknown,
  retryAfter: string | null,
  decode: Decoder<T>,
): { readonly answer: Answer<T>; readonly errorCode: PaylovErrorCode | undefined } {
  const normalized = normalizeResponse(body, context, endpoint.shape, retryAfter);
  if (normalized.kind === 'failure')
    return { answer: normalized, errorCode: normalized.error.code };
  const answer = decodePayload(normalized.payload, context, decodeRoot(endpoint.shape), decode);
  return { answer, errorCode: answer.kind === 'malformed' ? answer.error.code : undefined };
}

/** Whether a GET may retry: a connection failure other than an abort, or a transient status. */
function isTransientFailure(outcome: Attempt<unknown>): boolean {
  return outcome.kind === 'failed'
    ? outcome.failure.code !== 'sdk_aborted'
    : isRetryableStatus(outcome.context.httpStatus);
}

/**
 * Only the gateway's own authentication rejection is replayed. Bearer authentication rejects
 * before any handler runs: a `hold/create` refused with 401 left no transaction
 * (docs/architecture.md), so the rejected request did not execute. Only the documented envelope
 * proves that: a bare 401 (a proxy) or an envelope without `result: null` normalizes to a protocol
 * error and is never replayed.
 * The token transport has no AuthProvider.
 */
function isTokenRejection<T>(
  outcome: Attempt<T>,
): outcome is ReceivedAttempt<T> & { readonly authorization: AuthorizationContext } {
  return (
    outcome.kind === 'received' &&
    outcome.context.httpStatus === 401 &&
    outcome.answer.kind === 'failure' &&
    isPaylovApiError(outcome.answer.error, 'permission_denied') &&
    outcome.authorization !== undefined
  );
}

/** The call's answer from its final attempt: the decoded value, or the attempt's error. */
function settle<T>(outcome: Attempt<T>): T {
  if (outcome.kind === 'failed') throw outcome.failure;
  const { answer } = outcome;
  if (answer.kind === 'success') return answer.value;
  throw answer.error;
}

/** Everything about a request that stays the same across its attempts. */
interface PreparedRequest {
  readonly method: PaylovHttpMethod;
  /** The static identity, from {@link endpointName}. */
  readonly endpoint: string;
  readonly effect: EndpointEffect;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly signal: AbortSignal | undefined;
}

function prepareRequest(
  origin: string,
  endpoint: Endpoint,
  options: RequestOptions,
): PreparedRequest {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return {
    method: endpoint.method,
    endpoint: endpointName(endpoint),
    effect: endpoint.effect,
    url: buildUrl(origin, endpoint.route, options),
    headers: requestHeaders(options.headers, body !== undefined),
    body,
    signal: options.signal,
  };
}

/** Rechecked after the synchronous request hook, which may close the client or abort. */
function refusalAfterHook(
  lifecycle: ClientLifecycle | undefined,
  signal: AbortSignal | undefined,
  aborted: () => PaylovConnectionError,
): PaylovClientClosedError | PaylovConnectionError | undefined {
  if (lifecycle?.closed === true) return clientClosedError();
  return signal?.aborted === true ? aborted() : undefined;
}

/**
 * The credentials of one attempt. A failed grant stopped the call before its operation was sent, so
 * the grant's error reaches the caller with a known outcome.
 */
async function authorizeAttempt(
  auth: AuthProvider,
  signal: AbortSignal | undefined,
  aborted: () => PaylovConnectionError,
): Promise<AuthorizationContext> {
  try {
    return await untilAborted(auth.authorize(), signal, aborted);
  } catch (error) {
    throw beforeOperation(error);
  }
}

export function createHttpClient(config: HttpClientConfig): HttpClient {
  const fetchImpl: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxGetRetries = config.maxGetRetries ?? DEFAULT_GET_RETRIES;
  const { auth, lifecycle, logger, origin } = config;
  const sleep = config.sleep ?? defaultSleep;
  const random = config.random ?? Math.random;

  /** Exponential backoff for the 1-based retry number, with jitter in `[0.5, 1]`. */
  function backoffMs(retryNumber: number): number {
    const step = BASE_DELAY_MS * 2 ** (retryNumber - 1);
    return step * (0.5 + random() * 0.5);
  }

  /**
   * One fetch and its body read under one deadline, so a gateway that sends headers and then
   * stalls cannot hang the call. Every failure becomes a connection error without a cause.
   */
  async function exchange(prepared: PreparedRequest, init: RequestInit): Promise<Exchange> {
    const callerSignal = prepared.signal;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal === undefined ? timeout : AbortSignal.any([timeout, callerSignal]);
    const failed = (): Failed => {
      const code = failureCode(callerSignal, timeout);
      const deadline = code === 'sdk_timeout' ? timeoutMs : undefined;
      const { endpoint, effect } = prepared;
      return { kind: 'failed', failure: attemptFailure(code, endpoint, effect, deadline) };
    };

    let response: Response;
    try {
      response = await raceAbort(fetchImpl(prepared.url, { ...init, signal }), signal);
    } catch {
      return failed();
    }
    // Redirects are disabled; a 3xx is final and its body is never read.
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(noop);
      return { kind: 'received', response, body: undefined };
    }
    try {
      return { kind: 'received', response, body: await raceAbort(readJson(response), signal) };
    } catch {
      // Unless the caller aborted, a 429 stays a bodiless 429: never retried, and the token
      // manager still cools down.
      const keepsRateLimit = response.status === RATE_LIMITED && callerSignal?.aborted !== true;
      return keepsRateLimit ? { kind: 'received', response, body: undefined } : failed();
    }
  }

  /**
   * One authorized, logged attempt. Refusals before the fetch throw with a known outcome, since an
   * earlier attempt was a rejected token or a retried read; fetch failures return. `isSent` tells
   * whether an earlier attempt of the call reached fetch. The response event is emitted once the
   * endpoint's decoder has read the response, so it reports a 2xx that broke the endpoint's
   * contract.
   */
  async function sendAttempt<T>(
    endpoint: Endpoint,
    prepared: PreparedRequest,
    attempt: number,
    isSent: boolean,
    decode: Decoder<T>,
  ): Promise<Attempt<T>> {
    const { method, signal } = prepared;
    const aborted = (): PaylovConnectionError => abortedError(prepared.endpoint, isSent);
    if (signal?.aborted === true) throw aborted();
    const authorization =
      auth === undefined ? undefined : await authorizeAttempt(auth, signal, aborted);
    lifecycle?.assertOpen();

    const closeAttempt = logAttempt(logger, method, prepared.endpoint, attempt);
    const refusal = refusalAfterHook(lifecycle, signal, aborted);
    if (refusal !== undefined) {
      closeAttempt(0, refusal.code);
      throw refusal;
    }

    const headers =
      authorization === undefined
        ? prepared.headers
        : { ...prepared.headers, authorization: authorization.header };
    const init: RequestInit = {
      method,
      redirect: 'manual',
      headers,
      ...(prepared.body !== undefined ? { body: prepared.body } : {}),
    };
    const outcome = await exchange(prepared, init);
    if (outcome.kind === 'failed') {
      closeAttempt(0, outcome.failure.code);
      return outcome;
    }
    const { response, body } = outcome;
    const context = responseContext(endpoint, response.status);
    const retryAfter = response.headers.get('retry-after');
    const { answer, errorCode } = readAnswer(endpoint, context, body, retryAfter, decode);
    closeAttempt(response.status, errorCode);
    return { kind: 'received', context, answer, authorization };
  }

  async function request<T>(
    endpoint: Endpoint,
    options: RequestOptions,
    decode: Decoder<T>,
  ): Promise<T> {
    const prepared = prepareRequest(origin, endpoint, options);
    const { signal } = prepared;
    const abortedAfterSend = (): PaylovConnectionError => abortedError(prepared.endpoint, true);
    // Failure retries are GET-only whatever the configuration: Paylov documents no idempotency,
    // not even for DELETE.
    const maxRetries = endpoint.method === 'GET' ? maxGetRetries : 0;
    let retriesUsed = 0;
    let replayed = false;
    let isSent = false;

    for (let attempt = 1; ; attempt += 1) {
      const outcome = await sendAttempt(endpoint, prepared, attempt, isSent, decode);
      isSent = true;
      if (!replayed && isTokenRejection(outcome)) {
        replayed = true;
        auth?.invalidate(outcome.authorization.generation);
        continue;
      }
      if (retriesUsed < maxRetries && isTransientFailure(outcome)) {
        retriesUsed += 1;
        await untilAborted(sleep(backoffMs(retriesUsed), signal), signal, abortedAfterSend);
        continue;
      }
      return settle(outcome);
    }
  }

  return { request };
}
