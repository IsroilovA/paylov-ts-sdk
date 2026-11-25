/** Shared public types and the internal transport contracts every surface builds on. */

import type { PaylovErrorCode } from './errorCodes.js';

/** Per-call options accepted by every SDK method that performs I/O. */
export interface PaylovCallOptions {
  /**
   * Aborts the call with `PaylovConnectionError` `sdk_aborted`. Once a request was sent
   * (`isSent`), the outcome of a POST is unknown, like any connection error. A shared token grant
   * other calls wait on is never cancelled by one caller's abort.
   */
  readonly signal?: AbortSignal;
}

/** A JSON value as it travels on the wire. */
export type PaylovJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly PaylovJsonValue[]
  | PaylovJsonObject;

/** A JSON object, such as merchant-owned `account` data. */
export interface PaylovJsonObject {
  readonly [key: string]: PaylovJsonValue;
}

/** The subset of `fetch` the SDK uses. Injectable so tests never touch the network. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The HTTP methods the gateway's endpoints use. */
export type PaylovHttpMethod = 'GET' | 'POST' | 'DELETE';

/** Request metadata. Bodies, headers, query values and path identifiers are never logged. */
export interface PaylovLoggerRequestEvent {
  readonly method: PaylovHttpMethod;
  /** Static identity such as `"POST /merchant/oauth2/token/"`, without identifiers. */
  readonly endpoint: string;
  /** 1-based; a retry and a re-authentication replay both increment it. */
  readonly attempt: number;
}

/**
 * Closes every attempt that `onRequest` opened. An attempt without a complete response has
 * `httpStatus` `0` and `errorCode` `sdk_timeout`, `sdk_network_error` or `sdk_aborted`, or
 * `sdk_client_closed` when the client closed before the request was sent.
 */
export interface PaylovLoggerResponseEvent extends PaylovLoggerRequestEvent {
  readonly httpStatus: number;
  readonly durationMs: number;
  /** The validated gateway `error.code` when the body carried one, or the SDK's own code. */
  readonly errorCode?: PaylovErrorCode;
}

/** Metadata-only observability. Hook failures are discarded and async hooks are not awaited. */
export interface PaylovLogger {
  onRequest?(event: PaylovLoggerRequestEvent): void | Promise<void>;
  onResponse?(event: PaylovLoggerResponseEvent): void | Promise<void>;
}

/** The transport options every network surface's configuration shares. */
export interface PaylovTransportConfig {
  /**
   * Integer milliseconds in [1, 2147483647], default 30000. Bounds each HTTP attempt (fetch and
   * body read), token requests included, not the whole call. Pass a `signal` to bound a call.
   */
  readonly timeoutMs?: number;
  /**
   * How many times a GET is retried after a connection failure other than an abort, or HTTP
   * 500/502/503/504: an integer from 0 to 5, default 2, with exponential backoff. POST and DELETE
   * requests are never retried, whatever this is.
   */
  readonly maxGetRetries?: number;
  /** Defaults to `globalThis.fetch`. Injected in tests and behind proxies. */
  readonly fetch?: FetchLike;
  /** Observability hooks. Events contain metadata only; hook failures are discarded. */
  readonly logger?: PaylovLogger;
}

/**
 * The documented success shape of an endpoint, declared per call and never guessed:
 * - `envelope`: `{result, error}`; `result` is returned.
 * - `flat`: the record itself (token, revoke, onboarding, status).
 * - `array`: a bare JSON array (bank list).
 */
export type ResponseShape = 'envelope' | 'flat' | 'array';

/** No request body, query values or headers: they hold passwords and caller identifiers. */
export interface ResponseContext {
  /** Static endpoint identity, e.g. `"POST /merchant/receipts/pay/"`. */
  readonly endpoint: string;
  readonly httpStatus: number;
}

/** What one request adds to its endpoint: values only, never the route, method or shape. */
export interface RequestOptions {
  /** The value of each `{name}` placeholder of the route, encoded as one path segment. */
  readonly path?: Readonly<Record<string, string>> | undefined;
  /** Values are stringified; `undefined` values are dropped. */
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>> | undefined;
  /** A plain JSON value built by the caller from parsed params; serialized once. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** The caller's signal; `undefined` when the call has none. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * One gateway endpoint as its owning surface declares it. Resources send through it and the fake
 * gateway answers from it, so the route, method and shape have one home.
 */
export interface Endpoint {
  readonly method: PaylovHttpMethod;
  /** Absolute path template; the transport fills each `{name}` from the request's `path`. */
  readonly route: `/${string}`;
  readonly shape: ResponseShape;
  /**
   * The endpoint can charge, reserve, capture, release, refund or split money, so a generic
   * failure code from it leaves the outcome unknown (`PaylovApiError.isUnsettled`).
   */
  readonly movesMoney?: true;
}

/** Raw headers and `Response` objects never cross this boundary. */
export interface HttpResponse {
  /** Untyped until the owning decoder establishes a type. */
  readonly payload: unknown;
  readonly context: ResponseContext;
}

/**
 * Logs and errors name a request by its endpoint, never by its filled path. Failure retries
 * derive from the method alone; never add an option that retries a POST.
 */
export interface HttpClient {
  request(endpoint: Endpoint, options?: RequestOptions): Promise<HttpResponse>;
}

export interface AuthorizationContext {
  readonly header: string;
  readonly generation: number;
}

/** The transport depends on this interface, never on `TokenManager`. */
export interface AuthProvider {
  /** Concurrent callers share one token grant; callers race it against their own signal. */
  authorize(): Promise<AuthorizationContext>;
  /** Ignores a stale generation, so a late 401 cannot invalidate a newer token. */
  invalidate(generation: number): void;
}
