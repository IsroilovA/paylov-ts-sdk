/** Transport: URL construction, deadlines, abort, metadata logging, GET-only retries, 401 replay. */

import { setTimeout as delay } from 'node:timers/promises';

import { envelopeErrorCode, normalizeResponse } from './envelope.js';
import {
  abortedError,
  clientClosedError,
  invalidInput,
  PaylovConnectionError,
  type PaylovClientClosedError,
} from './errors.js';
import { raceAbort, untilAborted, type ClientLifecycle } from './lifecycle.js';
import type {
  AuthorizationContext,
  AuthProvider,
  Endpoint,
  FetchLike,
  HttpClient,
  HttpResponse,
  PaylovHttpMethod,
  PaylovLogger,
  PaylovTransportConfig,
  RequestOptions,
  ResponseShape,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
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

/** The static identity logs and errors carry, e.g. `"GET /merchant/userCard/getCard/{cardId}/"`. */
export function endpointName(endpoint: Pick<Endpoint, 'method' | 'route'>): string {
  return `${endpoint.method} ${endpoint.route}`;
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

/** A received exchange with the envelope code it logged and the credentials it carried. */
interface ReceivedAttempt extends Received {
  readonly errorCode: string | undefined;
  readonly authorization: AuthorizationContext | undefined;
}

type Exchange = Received | Failed;
type Attempt = ReceivedAttempt | Failed;

/** Whether a GET may retry: a connection failure other than an abort, or a transient status. */
function isTransientFailure(outcome: Attempt): boolean {
  return outcome.kind === 'failed'
    ? outcome.failure.code !== 'sdk_aborted'
    : isRetryableStatus(outcome.response.status);
}

/**
 * Only the gateway's own authentication rejection is replayed. Bearer authentication is expected
 * to reject before any handler runs (an inference: every captured 401 answered a GET), so the
 * rejected request should not have executed. A bare 401 (a proxy) proves nothing about the token.
 * The token transport has no AuthProvider.
 */
function isTokenRejection(
  outcome: Attempt,
): outcome is ReceivedAttempt & { readonly authorization: AuthorizationContext } {
  return (
    outcome.kind === 'received' &&
    outcome.response.status === 401 &&
    outcome.errorCode === 'permission_denied' &&
    outcome.authorization !== undefined
  );
}

/** Everything about a request that stays the same across its attempts. */
interface PreparedRequest {
  readonly method: PaylovHttpMethod;
  /** The static identity, from {@link endpointName}. */
  readonly endpoint: string;
  readonly shape: ResponseShape;
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
    shape: endpoint.shape,
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

export function createHttpClient(config: HttpClientConfig): HttpClient {
  const fetchImpl: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
  async function exchange(
    url: string,
    init: RequestInit,
    endpoint: string,
    callerSignal: AbortSignal | undefined,
  ): Promise<Exchange> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal === undefined ? timeout : AbortSignal.any([timeout, callerSignal]);
    const failed = (): Failed => {
      const code = failureCode(callerSignal, timeout);
      const failure = new PaylovConnectionError({
        code,
        endpoint,
        isSent: true,
        timeoutMs: code === 'sdk_timeout' ? timeoutMs : undefined,
      });
      return { kind: 'failed', failure };
    };

    let response: Response;
    try {
      response = await raceAbort(fetchImpl(url, { ...init, signal }), signal);
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
   * One authorized, logged attempt. Refusals before the fetch throw; fetch failures return.
   * `isSent` tells whether an earlier attempt of the call reached fetch.
   */
  async function sendAttempt(
    prepared: PreparedRequest,
    attempt: number,
    isSent: boolean,
  ): Promise<Attempt> {
    const { method, endpoint, signal } = prepared;
    const aborted = (): PaylovConnectionError => abortedError(endpoint, isSent);
    if (signal?.aborted === true) throw aborted();
    const authorization =
      auth === undefined ? undefined : await untilAborted(auth.authorize(), signal, aborted);
    lifecycle?.assertOpen();

    const closeAttempt = logAttempt(logger, method, endpoint, attempt);
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
    const outcome = await exchange(prepared.url, init, endpoint, signal);
    if (outcome.kind === 'failed') {
      closeAttempt(0, outcome.failure.code);
      return outcome;
    }
    const errorCode = envelopeErrorCode(outcome.body);
    closeAttempt(outcome.response.status, errorCode);
    return { ...outcome, errorCode, authorization };
  }

  async function request(endpoint: Endpoint, options: RequestOptions = {}): Promise<HttpResponse> {
    const prepared = prepareRequest(origin, endpoint, options);
    const { signal } = prepared;
    const abortedAfterSend = (): PaylovConnectionError => abortedError(prepared.endpoint, true);
    // Failure retries are GET-only: Paylov documents no idempotency, not even for DELETE.
    const retryable = endpoint.method === 'GET';
    let retriesUsed = 0;
    let replayed = false;
    let isSent = false;

    for (let attempt = 1; ; attempt += 1) {
      const outcome = await sendAttempt(prepared, attempt, isSent);
      isSent = true;
      if (!replayed && isTokenRejection(outcome)) {
        replayed = true;
        auth?.invalidate(outcome.authorization.generation);
        continue;
      }
      if (retryable && retriesUsed < MAX_RETRIES && isTransientFailure(outcome)) {
        retriesUsed += 1;
        await untilAborted(sleep(backoffMs(retriesUsed), signal), signal, abortedAfterSend);
        continue;
      }
      if (outcome.kind === 'failed') throw outcome.failure;

      const { response } = outcome;
      const context = { endpoint: prepared.endpoint, httpStatus: response.status };
      const retryAfter = response.headers.get('retry-after');
      const payload = normalizeResponse(outcome.body, context, prepared.shape, retryAfter);
      return { payload, context };
    }
  }

  return { request };
}
