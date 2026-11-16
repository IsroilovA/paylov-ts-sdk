/** The scripted in-memory Paylov gateway behind the `@isroilov_an/paylov/testing` entry point. */

import { createCardsFake } from '../cards/fake.js';
import type { CardsResource } from '../cards/resource.js';
import type { PaylovClientConfig } from '../client.js';
import { ENDPOINTS as AUTH_ENDPOINTS } from '../core/auth.js';
import { isWireErrorCode } from '../core/envelope.js';
import type { PaylovErrorCode } from '../core/errorCodes.js';
import { decodeErrorDetails } from '../core/errorDetails.js';
import { isRecord } from '../core/decoding.js';
import {
  encodeErrorDetails,
  FAKE_AUTH_BODIES,
  MISS,
  type FakeRequest,
  type MethodNameOf,
  type PaylovFakeFailure,
  type PaylovFakeMethod,
  type PaylovFakeSchedule,
  type PaylovFakeSurface,
  type RequestDecoder,
  type RequestMatcher,
} from '../core/fake.js';
import { endpointName, isRetryableStatus } from '../core/http.js';
import { readParams } from '../core/params.js';
import type { Endpoint, FetchLike } from '../core/types.js';
import { createFiscalizationFake } from '../fiscalization/fake.js';
import type { FiscalizationResource } from '../fiscalization/resource.js';
import { createGatewayFake } from '../gateway/fake.js';
import type { GatewayResource } from '../gateway/resource.js';
import { createHoldsFake } from '../holds/fake.js';
import type { HoldsResource } from '../holds/resource.js';
import type { PaylovOnboarding } from '../onboarding/client.js';
import { createOnboardingFake } from '../onboarding/fake.js';
import type { PaylovOnboardingConfig } from '../onboarding/types.js';
import { createPaymentsFake } from '../payments/fake.js';
import type { PaymentsResource } from '../payments/resource.js';
import { createSplitsFake } from '../splits/fake.js';
import type { SplitsResource } from '../splits/resource.js';
import { createSubMerchantsFake } from '../subMerchants/fake.js';
import type { SubMerchantsResource } from '../subMerchants/resource.js';
import { createTransactionsFake } from '../transactions/fake.js';
import type { TransactionsResource } from '../transactions/resource.js';

const BASE_URL = 'https://gateway.example';
/** Not SDK or gateway codes, so a request the script cannot serve never reads as a real failure. */
const UNSCRIPTED_CODE = 'fake_unscripted';
const UNREADABLE_CODE = 'fake_unreadable_request';
const FAKE_FAILURE_STATUS = 501;

/** The client surface behind each scripted namespace. */
interface ScriptedSurfaces {
  readonly gateway: GatewayResource;
  readonly cards: CardsResource;
  readonly payments: PaymentsResource;
  readonly transactions: TransactionsResource;
  readonly holds: HoldsResource;
  readonly splits: SplitsResource;
  readonly fiscalization: FiscalizationResource;
  readonly subMerchants: SubMerchantsResource;
  readonly onboarding: PaylovOnboarding;
}

/** `'<namespace>.<method>'` of every scripted SDK method, such as `'payments.pay'`. */
type ScriptedMethod = {
  [K in keyof ScriptedSurfaces]: MethodNameOf<K, ScriptedSurfaces[K]>;
}[keyof ScriptedSurfaces];

/** One request the fake received. */
export interface PaylovFakeCall {
  /**
   * The SDK method whose scripted answer served the request, such as `'payments.pay'`; `null`
   * for the token and revoke requests the fake answers itself and for requests no scripted
   * answer served.
   */
  readonly method: ScriptedMethod | null;
  /** The route as logger events name it, such as `'GET /merchant/userCard/getCard/{cardId}/'`. */
  readonly endpoint: string;
}

type Answer =
  | {
      readonly kind: 'respond';
      readonly httpStatus: number;
      readonly body: unknown;
      readonly retryAfter: string | null;
    }
  | { readonly kind: 'disconnect' }
  | { readonly kind: 'hang' };

/** Where one SDK method's requests arrive and how the fake records them. */
interface MethodRoute {
  readonly method: ScriptedMethod;
  readonly endpoint: Endpoint;
  readonly matches: RequestMatcher | undefined;
  /** Decodes the request into the method's `requests`; never keeps the raw request. */
  readonly record: (request: FakeRequest) => void;
}

interface ScriptedAnswer {
  readonly route: MethodRoute;
  readonly answer: Answer;
  readonly persist: boolean;
  /** Whether a persistent answer has served a request; one-time answers leave the queue instead. */
  served: boolean;
}

/** A request and the answer scripted for it. */
interface MatchedRequest {
  readonly scripted: ScriptedAnswer;
  readonly request: FakeRequest;
}

/** A request the SDK sends after a retryable answer to the same GET is likely its retry. */
interface ServedRequest {
  readonly endpoint: string;
  readonly isRetryable: boolean;
}

const RETRY_HINT =
  'the SDK retries a GET after a network error, a timeout or HTTP 500/502/503/504; script one answer per attempt or a persistent one';

/** The placeholder values of `path` under `route`, or `undefined` when it does not match. */
function routeValues(route: string, path: string): Record<string, string> | undefined {
  const pattern = RegExp.escape(route).replaceAll(/\\\{(\w+)\\\}/g, '(?<$1>[^/]+)');
  const match = new RegExp(`^${pattern}$`).exec(path);
  if (match === null) return undefined;
  return Object.fromEntries(
    Object.entries(match.groups ?? {}).map(([name, value]) => [name, decodeURIComponent(value)]),
  );
}

/** The parsed JSON body; anything else reads as no body, and never reaches an error. */
function parseBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** The request as `route` reads it, or `undefined` when its path does not match. */
function requestOf(route: string, url: URL, body: unknown): FakeRequest | undefined {
  const path = routeValues(route, url.pathname);
  if (path === undefined) return undefined;
  return {
    body: readParams(isRecord(body) ? body : {}, 'fake request body'),
    query: readParams(Object.fromEntries(url.searchParams), 'fake request query'),
    path: readParams(path, 'fake request path'),
  };
}

/** Whether the SDK retries the attempt `answer` serves on a GET. */
function isRetryableAnswer(answer: Answer): boolean {
  if (answer.kind === 'respond') return isRetryableStatus(answer.httpStatus);
  return true;
}

function jsonResponse(
  httpStatus: number,
  body: unknown,
  retryAfter: string | null = null,
): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (retryAfter !== null) headers.set('retry-after', retryAfter);
  return new Response(JSON.stringify(body), { status: httpStatus, headers });
}

function errorBody(error: unknown): unknown {
  return { result: null, error };
}

function respond(httpStatus: number, body: unknown, retryAfter: string | null = null): Answer {
  return { kind: 'respond', httpStatus, body, retryAfter };
}

/** The success answer for `payload`, or the endpoint's not-found error for `MISS`. */
function replyAnswer(endpoint: Endpoint, payload: unknown): Answer {
  if (payload === MISS) {
    return respond(400, errorBody({ code: endpoint.miss, message: String(endpoint.miss) }));
  }
  return respond(200, endpoint.shape === 'envelope' ? { result: payload, error: null } : payload);
}

/** Settles only when `signal` aborts, as a request the gateway never answers. */
function neverAnswered(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = (): void => {
      reject(new Error('The operation was aborted'));
    };
    if (signal?.aborted === true) abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function sameFields(requested: readonly string[], reported: readonly string[] = []): boolean {
  return requested.length === reported.length && requested.every((f, i) => f === reported[i]);
}

/** A gateway error that the SDK decodes back into exactly the requested failure. */
function failureAnswer(code: PaylovErrorCode, failure: PaylovFakeFailure): Answer {
  const { httpStatus = 400, fields, retryAfterSeconds } = failure;
  if (!isWireErrorCode(code) || code.startsWith('sdk_')) {
    throw new TypeError(
      'code must be a gateway error code; script SDK connection failures with disconnect() or hang()',
    );
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 400 || httpStatus > 599) {
    throw new TypeError('httpStatus must be an integer from 400 to 599');
  }
  const { error, retryAfter } = encodeErrorDetails(code, failure);
  const reported = decodeErrorDetails(code, error, retryAfter);
  const isReportable =
    (fields === undefined || sameFields(fields, reported.fields)) &&
    (retryAfterSeconds === undefined || retryAfterSeconds === reported.retryAfterSeconds);
  if (!isReportable) {
    throw new TypeError(
      `the gateway cannot report ${code} with these details at HTTP ${httpStatus}`,
    );
  }
  return respond(httpStatus, errorBody(error), retryAfter);
}

async function respondWith(
  answer: Answer,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (answer.kind === 'disconnect') throw new TypeError('fetch failed');
  if (answer.kind === 'hang') return await neverAnswered(signal);
  return jsonResponse(answer.httpStatus, answer.body, answer.retryAfter);
}

/**
 * An in-memory Paylov gateway for application tests. Pass `clientConfig` (or `onboardingConfig`)
 * to the SDK, script each expected call through the namespace that
 * mirrors the client, then call `assertDone()`. Answers run through the SDK's real transport and
 * decoders, so retries, the token lifecycle, errors and result types behave as against the
 * gateway. Token and revoke requests are answered automatically. Each method's `requests` holds
 * the params its served requests carried; requests never reach logs or errors.
 *
 * One-time answers are served in the order they were scripted, each to the first request of its
 * method; a persistent answer (`{ persist: true }`) serves every request of its method that no
 * one-time answer takes. Methods that send to the same gateway endpoint are told apart by their
 * request, so each answer reaches only its own method. An unscripted request fails with
 * `PaylovApiError` `fake_unscripted`, and a request the fake cannot read back into its method's
 * params with `fake_unreadable_request`, both at HTTP 501 and reported by `assertDone()`.
 *
 * @example
 * import { PaylovClient } from '@isroilov_an/paylov';
 * import { PaylovFakeGateway } from '@isroilov_an/paylov/testing';
 *
 * const fake = new PaylovFakeGateway();
 * const paylov = new PaylovClient(fake.clientConfig);
 * fake.payments.create.reply({ transactionId: '00000000-0000-4000-8000-000000000001' });
 * fake.payments.pay.fail('insufficient_funds');
 *
 * await expect(checkout(paylov, order)).rejects.toMatchObject({ code: 'insufficient_funds' });
 * fake.assertDone();
 */
export class PaylovFakeGateway {
  readonly gateway: PaylovFakeSurface<GatewayResource>;
  readonly cards: PaylovFakeSurface<CardsResource>;
  readonly payments: PaylovFakeSurface<PaymentsResource>;
  readonly transactions: PaylovFakeSurface<TransactionsResource>;
  readonly holds: PaylovFakeSurface<HoldsResource>;
  readonly splits: PaylovFakeSurface<SplitsResource>;
  readonly fiscalization: PaylovFakeSurface<FiscalizationResource>;
  readonly subMerchants: PaylovFakeSurface<SubMerchantsResource>;
  readonly onboarding: PaylovFakeSurface<PaylovOnboarding>;

  /** The `fetch` that answers from the script; the configurations below already carry it. */
  readonly fetch: FetchLike;
  /** A complete `PaylovClient` configuration with canary credentials; spread it to add options. */
  readonly clientConfig: PaylovClientConfig;
  /** A complete `PaylovOnboarding` configuration. */
  readonly onboardingConfig: PaylovOnboardingConfig;

  readonly #scripted: ScriptedAnswer[] = [];
  readonly #calls: PaylovFakeCall[] = [];
  /** What `assertDone()` reports about requests the script could not serve. */
  readonly #unserved: string[] = [];
  #lastServed: ServedRequest | undefined;

  constructor() {
    const script = <T, P>(
      method: ScriptedMethod,
      endpoint: Endpoint,
      encode: (result: T) => unknown,
      decodeRequest: RequestDecoder<P>,
      matches?: RequestMatcher,
    ): PaylovFakeMethod<T, P> => this.#script(method, endpoint, encode, decodeRequest, matches);
    this.gateway = createGatewayFake(script);
    this.cards = createCardsFake(script);
    this.payments = createPaymentsFake(script);
    this.transactions = createTransactionsFake(script);
    this.holds = createHoldsFake(script);
    this.splits = createSplitsFake(script);
    this.fiscalization = createFiscalizationFake(script);
    this.subMerchants = createSubMerchantsFake(script);
    this.onboarding = createOnboardingFake(script);

    this.fetch = (input, init) => this.#answer(input, init);
    this.clientConfig = {
      baseUrl: BASE_URL,
      consumerKey: 'EXAMPLE-FAKE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL',
      consumerSecret: 'EXAMPLE-FAKE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL',
      username: 'EXAMPLE-FAKE-USERNAME-NOT-A-REAL-CREDENTIAL',
      password: 'EXAMPLE-FAKE-PASSWORD-NOT-A-REAL-CREDENTIAL',
      fetch: this.fetch,
    };
    this.onboardingConfig = { baseUrl: BASE_URL, fetch: this.fetch };
  }

  /**
   * Every request received so far, in order, token and revoke requests included. Each method's
   * `requests` holds the params of its own requests.
   *
   * @example
   * expect(fake.calls.map((call) => call.method)).toEqual([null, 'payments.create', 'payments.pay']);
   */
  get calls(): readonly PaylovFakeCall[] {
    return [...this.#calls];
  }

  /**
   * Throws when a request arrived unscripted or unreadable, or a scripted answer was never served.
   *
   * @example
   * afterEach(() => fake.assertDone());
   */
  assertDone(): void {
    const problems = [
      ...this.#unserved,
      ...this.#scripted.flatMap(({ route, persist, served }) => {
        if (!persist) return [`unserved ${route.method} answer`];
        return served ? [] : [`unserved persistent ${route.method} answer`];
      }),
    ];
    if (problems.length > 0) throw new Error(`PaylovFakeGateway: ${problems.join('; ')}`);
  }

  #script<T, P>(
    method: ScriptedMethod,
    endpoint: Endpoint,
    encode: (result: T) => unknown,
    decodeRequest: RequestDecoder<P>,
    matches: RequestMatcher | undefined,
  ): PaylovFakeMethod<T, P> {
    const requests: P[] = [];
    const route: MethodRoute = {
      method,
      endpoint,
      matches,
      record: (request) => {
        requests.push(decodeRequest(request));
      },
    };
    const enqueue = (answer: Answer, schedule: PaylovFakeSchedule = {}): void => {
      this.#scripted.push({ route, answer, persist: schedule.persist === true, served: false });
    };
    return {
      requests,
      reply: (result, schedule) => {
        enqueue(replyAnswer(endpoint, encode(result)), schedule);
      },
      fail: (code, failure = {}, schedule) => {
        enqueue(failureAnswer(code, failure), schedule);
      },
      disconnect: (schedule) => {
        enqueue({ kind: 'disconnect' }, schedule);
      },
      hang: (schedule) => {
        enqueue({ kind: 'hang' }, schedule);
      },
    };
  }

  /** The first one-time answer for the request, else its first persistent answer. */
  #scriptedFor(method: string, url: URL, body: unknown): MatchedRequest | undefined {
    const candidates = this.#scripted.flatMap((scripted) => {
      const { endpoint, matches } = scripted.route;
      const request = endpoint.method === method ? requestOf(endpoint.route, url, body) : undefined;
      return request !== undefined && (matches?.(request) ?? true) ? [{ scripted, request }] : [];
    });
    return candidates.find(({ scripted }) => !scripted.persist) ?? candidates[0];
  }

  async #answer(input: string, init: RequestInit): Promise<Response> {
    const method = init.method ?? 'GET';
    const url = new URL(input);
    const endpoint = `${method} ${url.pathname}`;
    let found: MatchedRequest | undefined;
    try {
      found = this.#scriptedFor(method, url, parseBody(init.body));
      found?.scripted.route.record(found.request);
    } catch {
      // A matcher or request decoder that disagrees with what the SDK sent is a fake defect; a
      // fetch rejection would read as a retried network failure instead.
      return this.#answerUnreadable(endpoint, found?.scripted.route.method);
    }
    if (found === undefined) return this.#answerUnmatched(method, url.pathname);
    const { scripted } = found;
    if (scripted.persist) scripted.served = true;
    else this.#scripted.splice(this.#scripted.indexOf(scripted), 1);
    this.#lastServed = {
      endpoint,
      isRetryable: method === 'GET' && isRetryableAnswer(scripted.answer),
    };
    this.#calls.push({
      method: scripted.route.method,
      endpoint: endpointName(scripted.route.endpoint),
    });
    return await respondWith(scripted.answer, init.signal);
  }

  #answerUnreadable(endpoint: string, method: ScriptedMethod | undefined): Response {
    this.#calls.push({ method: null, endpoint });
    const reader = method === undefined ? 'a request matcher' : `the ${method} request decoder`;
    this.#unserved.push(`unreadable request ${endpoint} (${reader} threw)`);
    const message = `the fake cannot read ${endpoint}`;
    return jsonResponse(FAKE_FAILURE_STATUS, errorBody({ code: UNREADABLE_CODE, message }));
  }

  #answerUnmatched(method: string, path: string): Response {
    const endpoint = `${method} ${path}`;
    this.#calls.push({ method: null, endpoint });
    if (method === AUTH_ENDPOINTS.token.method && path === AUTH_ENDPOINTS.token.route) {
      return jsonResponse(200, FAKE_AUTH_BODIES.token);
    }
    if (method === AUTH_ENDPOINTS.revoke.method && path === AUTH_ENDPOINTS.revoke.route) {
      return jsonResponse(200, FAKE_AUTH_BODIES.revoke);
    }
    const last = this.#lastServed;
    const isRetry = last?.endpoint === endpoint && last.isRetryable;
    const hint = isRetry ? ` (likely a retry: ${RETRY_HINT})` : '';
    this.#unserved.push(`unscripted request ${endpoint}${hint}`);
    const message = `no scripted answer for ${endpoint}`;
    return jsonResponse(FAKE_FAILURE_STATUS, errorBody({ code: UNSCRIPTED_CODE, message }));
  }
}
