/**
 * The only interpreter of raw Paylov response bodies. Every observed REST failure, the token,
 * revoke and onboarding endpoints included, is `{result: null, error: {code, message, data?}}`.
 * Success depends on the shape the endpoint declares; the SDK never guesses it.
 */

import { decodeErrorDetails } from './errorDetails.js';
import {
  malformedResponse,
  PaylovApiError,
  unexpectedStatus,
  type PaylovProtocolError,
  UNSETTLED_FAILURE_CODES,
} from './errors.js';
import { isRecord } from './decoding.js';
import type { Endpoint, ResponseContext, ResponseShape } from './types.js';

const WIRE_ERROR_CODE = /^[a-z][a-z0-9_]{0,127}$/;

/** Error codes are identifiers, never arbitrary response text. */
export function isWireErrorCode(value: unknown): value is string {
  return typeof value === 'string' && WIRE_ERROR_CODE.test(value);
}

function isSuccessStatus(httpStatus: number): boolean {
  return httpStatus >= 200 && httpStatus < 300;
}

/** The validated `error.code` a body carries, for logger events and the 401 replay rule. */
export function envelopeErrorCode(body: unknown): string | undefined {
  const error = isRecord(body) ? body['error'] : undefined;
  const code = isRecord(error) ? error['code'] : undefined;
  return isWireErrorCode(code) ? code : undefined;
}

/** A body that is neither a declared success nor a decodable error. */
function unusableBody(context: ResponseContext): PaylovProtocolError {
  return isSuccessStatus(context.httpStatus)
    ? malformedResponse(context)
    : unexpectedStatus(context);
}

function isUnsettledCode(code: string, endpoint: ResponseEndpoint): boolean {
  const isDefinitive = (endpoint.definitiveCodes ?? []).some((definitive) => definitive === code);
  return endpoint.movesMoney === true && UNSETTLED_FAILURE_CODES.has(code) && !isDefinitive;
}

function apiError(
  code: string,
  error: Readonly<Record<string, unknown>>,
  context: ResponseContext,
  endpoint: ResponseEndpoint,
  retryAfter: string | null,
): PaylovApiError {
  return new PaylovApiError({
    code,
    ...context,
    isUnsettled: isUnsettledCode(code, endpoint),
    ...decodeErrorDetails(code, error, retryAfter),
  });
}

function unwrapResult(body: Readonly<Record<string, unknown>>, context: ResponseContext): unknown {
  const result = body['result'];
  // `result` may be a primitive such as `true`; only null or absent is malformed.
  if (result === null || result === undefined) throw malformedResponse(context, 'result');
  return result;
}

function successPayload(body: unknown, context: ResponseContext, shape: ResponseShape): unknown {
  if (shape === 'array') {
    if (!Array.isArray(body)) throw malformedResponse(context);
    return body;
  }
  if (!isRecord(body)) throw malformedResponse(context);
  if (shape === 'flat') return body;
  return unwrapResult(body, context);
}

/** What the normalizer needs of the declared endpoint. */
export type ResponseEndpoint = Pick<Endpoint, 'shape' | 'movesMoney' | 'definitiveCodes'>;

/**
 * Returns the success payload as `unknown` for the owning decoder, or throws: `PaylovApiError`
 * for a decodable `error`, `PaylovProtocolError` for anything else. `retryAfter` is the
 * response's `Retry-After` header.
 */
export function normalizeResponse(
  body: unknown,
  context: ResponseContext,
  endpoint: ResponseEndpoint,
  retryAfter: string | null,
): unknown {
  // Branch on `error` being non-null, never on key presence or on the status alone: 404 carries
  // `card_not_found`, and some successes omit `error`.
  const error = isRecord(body) ? body['error'] : undefined;
  if (error !== null && error !== undefined) {
    const code = isRecord(error) ? error['code'] : undefined;
    if (!isRecord(error) || !isWireErrorCode(code)) throw unusableBody(context);
    throw apiError(code, error, context, endpoint, retryAfter);
  }
  if (!isSuccessStatus(context.httpStatus)) throw unexpectedStatus(context);
  return successPayload(body, context, endpoint.shape);
}
