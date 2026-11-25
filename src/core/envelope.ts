/**
 * The only interpreter of raw Paylov response bodies. Every observed REST failure, the token,
 * revoke and onboarding endpoints included, is `{result: null, error: {code, message, data?}}`.
 * Success depends on the shape the endpoint declares; the SDK never guesses it.
 */

import { decodeErrorDetails, decodeRetryAfterHeader } from './errorDetails.js';
import {
  gatewayError,
  malformedResponse,
  unexpectedStatus,
  type PaylovApiError,
  type PaylovProtocolError,
} from './errors.js';
import { isRecord } from './decoding.js';
import type { ResponseContext, ResponseShape } from './types.js';

const WIRE_ERROR_CODE = /^[a-z][a-z0-9_]{0,127}$/;
const RATE_LIMITED = 429;

/** A response that answers its call with an error. */
export interface NormalizedFailure {
  readonly kind: 'failure';
  readonly error: PaylovApiError | PaylovProtocolError;
}

/** A response read against its endpoint's contract. */
export type NormalizedResponse =
  | { readonly kind: 'success'; readonly payload: unknown }
  | NormalizedFailure;

/** Error codes are identifiers, never arbitrary response text. */
export function isWireErrorCode(value: unknown): value is string {
  return typeof value === 'string' && WIRE_ERROR_CODE.test(value);
}

function isSuccessStatus(httpStatus: number): boolean {
  return httpStatus >= 200 && httpStatus < 300;
}

function success(payload: unknown): NormalizedResponse {
  return { kind: 'success', payload };
}

function failure(error: PaylovApiError | PaylovProtocolError): NormalizedResponse {
  return { kind: 'failure', error };
}

/** The `Retry-After` delay of a 429 whose body is not a decodable error envelope. */
function rateLimitDelay(context: ResponseContext, retryAfter: string | null): number | undefined {
  return context.httpStatus === RATE_LIMITED ? decodeRetryAfterHeader(retryAfter) : undefined;
}

/** A body that is neither a declared success nor a decodable error. */
function unusableBody(context: ResponseContext, retryAfter: string | null): PaylovProtocolError {
  return isSuccessStatus(context.httpStatus)
    ? malformedResponse(context)
    : unexpectedStatus(context, rateLimitDelay(context, retryAfter));
}

/**
 * The error a body with a non-null `error` reports. Only the documented envelope, with an explicit
 * `result: null`, is a gateway answer: a contradicting or missing `result` proves nothing about
 * whether the request executed, so it is a protocol error.
 */
function envelopeError(
  body: Readonly<Record<string, unknown>>,
  context: ResponseContext,
  retryAfter: string | null,
): PaylovApiError | PaylovProtocolError {
  const error = body['error'];
  const code = isRecord(error) ? error['code'] : undefined;
  if (body['result'] !== null || !isRecord(error) || !isWireErrorCode(code)) {
    return unusableBody(context, retryAfter);
  }
  return gatewayError(
    context,
    code,
    decodeErrorDetails(code, error, context.httpStatus, retryAfter),
  );
}

function successPayload(
  body: unknown,
  context: ResponseContext,
  shape: ResponseShape,
): NormalizedResponse {
  if (shape === 'array')
    return Array.isArray(body) ? success(body) : failure(malformedResponse(context));
  if (!isRecord(body)) return failure(malformedResponse(context));
  if (shape === 'flat') return success(body);
  const result = body['result'];
  // `result` may be a primitive such as `true`; only null or absent is malformed.
  return result === null || result === undefined
    ? failure(malformedResponse(context, 'result'))
    : success(result);
}

/**
 * The success payload as `unknown` for the owning decoder, or the failure: `PaylovApiError` for a
 * decodable error envelope, `PaylovProtocolError` for anything else. `shape` is the endpoint's
 * declared success shape and `retryAfter` the response's `Retry-After` header.
 */
export function normalizeResponse(
  body: unknown,
  context: ResponseContext,
  shape: ResponseShape,
  retryAfter: string | null,
): NormalizedResponse {
  // Branch on `error` being non-null, never on key presence or on the status alone: 404 carries
  // `card_not_found`, and some successes omit `error`.
  if (isRecord(body) && body['error'] !== null && body['error'] !== undefined) {
    return failure(envelopeError(body, context, retryAfter));
  }
  if (!isSuccessStatus(context.httpStatus)) return failure(unusableBody(context, retryAfter));
  return successPayload(body, context, shape);
}
