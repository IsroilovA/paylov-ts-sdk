/**
 * The contract between the testing fake gateway and the per-surface spec tables, and the fake's
 * inverses of core's own wire reads: token bodies, error details, and timestamps. Each surface
 * encodes its own SDK results into wire payloads and decodes its own requests back into SDK
 * params, so wire names stay in the owning feature. Only fakes and `testing/` load this module,
 * so its token canaries ship only in the testing entry point's bundle.
 */

import { isRecord } from './decoding.js';
import type { PaylovErrorCode, PaylovKnownErrorCode } from './errorCodes.js';
import { tiyinToWireSum, wireSumToTiyin } from './money.js';
import type { Params } from './params.js';
import { MINUTE_MS, TASHKENT_OFFSET_MINUTES } from './time.js';
import type { Endpoint } from './types.js';

/** An encoder's answer for a result the gateway reports as error `code`. */
export class FakeRefusal {
  readonly code: PaylovKnownErrorCode;

  constructor(code: PaylovKnownErrorCode) {
    this.code = code;
  }
}

/** How a scripted failure reads once the SDK decodes it as a `PaylovApiError`. */
export interface PaylovFakeFailure {
  /** Default 400. Any status from 400 to 599. */
  readonly httpStatus?: number;
  /** `validation_error`, `field_not_valid` (one field) and `field_required` (one field) only. */
  readonly fields?: readonly string[];
  /**
   * From 1 to 3600, for `rate_limit_exceeded`, `card_is_blocked`, or any code at `httpStatus` 429.
   * Sent as the `Retry-After` header for a rate limit or a 429, else as the card block's rest.
   */
  readonly retryAfterSeconds?: number;
}

/** How long a scripted answer lasts. */
export interface PaylovFakeSchedule {
  /**
   * Serve this answer to every request of its method that no one-time answer matches, instead of
   * to one attempt; `assertDone()` then requires only that it served at least one. Default
   * `false`.
   */
  readonly persist?: boolean;
}

/**
 * The script of one SDK method. Each answer serves one HTTP attempt, unless `{ persist: true }`
 * keeps it for every attempt; the fake serves one-time answers in order. What the call then
 * resolves or rejects with follows the SDK's own rules: a GET that fails transiently is retried
 * against the next answer, a 401 `permission_denied` is replayed once after a new token, and a
 * method whose decoder reads a gateway error as a result returns that result.
 */
export interface PaylovFakeMethod<T, P> {
  /**
   * Answers one attempt with a success body that the SDK's decoder reads back as `result`, in the
   * gateway's wire shape; fields the SDK discards, such as upstream diagnostic text, are omitted.
   * Throws `TypeError` for a value the wire cannot carry, such as a fractional SUM or sub-second
   * time.
   *
   * @example
   * fake.payments.create.reply({ transactionId: '00000000-0000-4000-8000-000000000001' });
   */
  reply(result: T, schedule?: PaylovFakeSchedule): void;

  /**
   * Answers one attempt with gateway error `code` as the gateway reports it for this method,
   * usually an error response, for a lookup miss Paylov sends as a success body that body. The
   * SDK decodes it as it would the gateway's answer: most methods reject with `PaylovApiError`
   * `code`, while `onboarding.checkToken` resolves `false` for `invalid_or_expired`. Throws
   * `TypeError` for a failure the gateway cannot report, such as `fields` on a code without them.
   *
   * @example
   * fake.payments.pay.fail('insufficient_funds');
   * fake.transactions.get.fail('server_error', { httpStatus: 500 }, { persist: true });
   */
  fail(code: PaylovErrorCode, failure?: PaylovFakeFailure, schedule?: PaylovFakeSchedule): void;

  /**
   * Fails one attempt before any response, as a dropped connection. The SDK retries a GET against
   * the next answer while `maxGetRetries` allows; a call it does not retry rejects with
   * `PaylovConnectionError` `sdk_network_error`, and the outcome of a method that changes state is
   * unknown.
   *
   * @example
   * fake.payments.pay.disconnect();
   */
  disconnect(schedule?: PaylovFakeSchedule): void;

  /**
   * Never answers one attempt. The SDK abandons it after `timeoutMs` and retries a GET against the
   * next answer while `maxGetRetries` allows; a call it does not retry rejects with `sdk_timeout`.
   * An abort of the call's signal ends the call with `sdk_aborted`.
   *
   * @example
   * fake.payments.pay.hang();
   */
  hang(schedule?: PaylovFakeSchedule): void;

  /**
   * The params of each attempt this method's answers served, in order, decoded from the request
   * the SDK sent: wire names and units read back as the method's own params, so a retried GET
   * appears once per attempt. It holds a full card number where the method's params do, which is
   * your own test input; it never holds a password. A method that takes no params records
   * `undefined`.
   *
   * @example
   * expect(fake.holds.capture.requests).toEqual([{ transactionId, amountTiyin: 150_000 }]);
   */
  readonly requests: readonly P[];
}

/** A request the fake gateway received, read with the SDK's own params reader. */
export interface FakeRequest {
  /** The JSON body; empty without one. */
  readonly body: Params;
  /** Query values, all strings. */
  readonly query: Params;
  /** The values of the route's `{name}` placeholders. */
  readonly path: Params;
}

/** Whether a request belongs to a method; methods sharing an endpoint each declare one. */
export type RequestMatcher = (request: FakeRequest) => boolean;

/** Reads a request back into the params of the method that sent it; the inverse of its encoding. */
type RequestDecoder<P> = (request: FakeRequest) => P;

/** The result type of an SDK method. */
type ResultOf<M> = M extends (...args: never[]) => Promise<infer T> ? T : never;

/** Never a password: the fake must not retain a credential. */
type RecordedParams<P> = P extends { readonly password: unknown } ? Omit<P, 'password'> : P;

/**
 * What the fake records of a request. Every I/O method takes its call options last, so a method
 * of at most one parameter takes only options and sends no params.
 */
export type RequestOf<M> = M extends (...args: infer A) => Promise<unknown>
  ? [A['length']] extends [0 | 1]
    ? undefined
    : RecordedParams<NonNullable<A[0]>>
  : never;

/** The I/O methods of surface `R`. */
export type IoMethodOf<R> = {
  [K in keyof R]: R[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof R];

/** What method `K` of surface `R` is scripted with: its result, unless `Replies` names another. */
export type ReplyOf<R, K extends keyof R, Replies> = K extends keyof Replies
  ? Replies[K]
  : ResultOf<R[K]>;

/**
 * A miss the gateway reports in a success body, which the method's decoder reads as `code`.
 * Scripting or simulating `code` for the method sends `payload` at HTTP 200, as the gateway does.
 */
interface FakeMiss {
  readonly code: PaylovKnownErrorCode;
  /** The success payload, unwrapped. */
  readonly payload: unknown;
}

/**
 * One SDK method in the fake: where its requests arrive, how its replies are encoded, and how its
 * requests read back into its params. Scripted answers and the simulation both use it.
 */
export interface FakeMethodSpec<T, P> {
  readonly endpoint: Endpoint;
  /** The success payload, unwrapped, or a `FakeRefusal`. */
  readonly encode: (result: T) => unknown;
  readonly decodeRequest: RequestDecoder<P>;
  /** The HTTP status of a success, as the gateway sends it. Default 200. */
  readonly successStatus?: number;
  /** For methods sharing an endpoint: whether a request is this method's. */
  readonly matches?: RequestMatcher;
  readonly miss?: FakeMiss;
}

/**
 * The spec of every I/O method of surface `R`, keyed by method. `Replies` names the methods whose
 * reply is what the gateway sends rather than the method's result.
 */
export type FakeSpecTable<R, Replies = unknown> = {
  readonly [K in IoMethodOf<R>]: FakeMethodSpec<ReplyOf<R, K, Replies>, RequestOf<R[K]>>;
};

/**
 * One script per I/O method of surface `R`, mirroring how the client exposes it. `Replies` names
 * the methods scripted with what the gateway sends rather than the method's result, as
 * `holds.create` replies `{ transactionId }` and the SDK adds the capture deadline itself.
 */
export type PaylovFakeSurface<R, Replies = unknown> = {
  readonly [K in IoMethodOf<R>]: PaylovFakeMethod<ReplyOf<R, K, Replies>, RequestOf<R[K]>>;
};

/** `{ [key]: value }`, or `{}` for a value the request omitted. */
export function optionalEntry<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  const entry: Partial<Record<K, V>> = {};
  if (value !== undefined) entry[key] = value;
  return entry;
}

/** The wire whole-SUM integer `key` as tiyin, the inverse of `encodeWholeSum`. */
export function decodeWholeSum(params: Params, key: string): number {
  const amountTiyin = wireSumToTiyin(params.integer(key));
  if (amountTiyin === undefined) throw unencodable(key, 'must be a non-negative SUM amount');
  return amountTiyin;
}

function unencodable(field: string, rule: string): TypeError {
  return new TypeError(`${field} ${rule}`);
}

/** Wire whole SUM; throws `TypeError` for an amount with tiyin. */
export function encodeWholeSum(amountTiyin: number, field: string): number {
  const sum = tiyinToWireSum(amountTiyin);
  if (sum === undefined) throw unencodable(field, 'must be a whole SUM amount in tiyin');
  return sum;
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** Wall-clock `YYYY-MM-DD HH:mm:ss` of `date` at a fixed offset, as the time parsers read it. */
function localDateTimeOf(date: Date, offsetMinutes: number, field: string): string {
  const ms = date.getTime();
  const local = new Date(ms + offsetMinutes * MINUTE_MS);
  const year = local.getUTCFullYear();
  const isFourDigitYear = year >= 0 && year <= 9999;
  if (!Number.isFinite(ms) || ms % 1000 !== 0 || !isFourDigitYear) {
    throw unencodable(field, 'must be a valid date in whole seconds');
  }
  const day = `${String(year).padStart(4, '0')}-${two(local.getUTCMonth() + 1)}-${two(local.getUTCDate())}`;
  return `${day} ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}:${two(local.getUTCSeconds())}`;
}

/** Wire Tashkent `YYYY-MM-DD HH:mm:ss`; throws `TypeError` for sub-second or invalid dates. */
export function tashkentDateTimeOf(date: Date, field: string): string {
  return localDateTimeOf(date, TASHKENT_OFFSET_MINUTES, field);
}

/** Wire UTC `YYYY-MM-DD HH:mm:ss`; throws `TypeError` for sub-second or invalid dates. */
export function utcDateTimeOf(date: Date, field: string): string {
  return localDateTimeOf(date, 0, field);
}

/** Wire unix seconds; throws `TypeError` for sub-second, invalid or pre-1970 dates. */
export function unixSecondsOf(date: Date, field: string): number {
  const ms = date.getTime();
  if (!Number.isFinite(ms) || ms < 0 || ms % 1000 !== 0) {
    throw unencodable(field, 'must be a date from 1970 in whole seconds');
  }
  return ms / 1000;
}

/** `T | null` encoded with `encode`, keeping `null`. */
export function nullableOf<T>(value: T | null, encode: (value: T) => unknown): unknown {
  return value === null ? null : encode(value);
}

/** What the fake gateway answers on the token and revoke endpoints; tokens are canaries. */
export const FAKE_AUTH_BODIES = {
  token: {
    access_token: 'EXAMPLE-FAKE-ACCESS-TOKEN-NOT-A-REAL-TOKEN',
    refresh_token: 'EXAMPLE-FAKE-REFRESH-TOKEN-NOT-A-REAL-TOKEN',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_expires_in: 2_592_000,
  },
  revoke: { status: 'success' },
} as const;

function nestFieldPaths(paths: readonly string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const path of paths) {
    const segments = path.split('.');
    const leaf = segments.pop() ?? path;
    let node = root;
    for (const segment of segments) {
      const child = node[segment];
      const next: Record<string, unknown> = isRecord(child) ? { ...child } : {};
      node[segment] = next;
      node = next;
    }
    node[leaf] = ['invalid'];
  }
  return root;
}

const RATE_LIMITED = 429;

/** A gateway error response: its `error` body and its `Retry-After` header. */
interface EncodedError {
  readonly error: Readonly<Record<string, unknown>>;
  readonly retryAfter: string | null;
}

function errorDataOf(code: string, fields: readonly string[], retryAfterSeconds?: number): unknown {
  if (code === 'field_not_valid' || code === 'field_required') return { field: fields[0] ?? '' };
  if (code === 'card_is_blocked' && retryAfterSeconds !== undefined) {
    return { sec_to_retry: retryAfterSeconds };
  }
  return nestFieldPaths(fields);
}

/**
 * A gateway error response at `httpStatus` that `decodeErrorDetails` reads back as `details`,
 * when the gateway can express them for `code`; the caller verifies by decoding it.
 */
export function encodeErrorDetails(
  code: string,
  httpStatus: number,
  details: Pick<PaylovFakeFailure, 'fields' | 'retryAfterSeconds'>,
): EncodedError {
  const { fields = [], retryAfterSeconds } = details;
  const isRateLimit = code === 'rate_limit_exceeded' || httpStatus === RATE_LIMITED;
  const isRateLimitDelay = isRateLimit && retryAfterSeconds !== undefined;
  return {
    error: {
      code,
      message: code,
      data: errorDataOf(code, fields, retryAfterSeconds),
    },
    retryAfter: isRateLimitDelay ? String(retryAfterSeconds) : null,
  };
}
