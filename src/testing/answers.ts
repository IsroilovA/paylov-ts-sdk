/** The fake gateway's HTTP answers, built so the SDK decodes each back into what was scripted. */

import { isWireErrorCode } from '../core/envelope.js';
import type { PaylovErrorCode } from '../core/errorCodes.js';
import { decodeErrorDetails } from '../core/errorDetails.js';
import { encodeErrorDetails, MISS, type PaylovFakeFailure } from '../core/fake.js';
import { isRetryableStatus } from '../core/http.js';
import type { Endpoint } from '../core/types.js';

/** The status of answers the fake gives about itself: never a gateway or SDK answer. */
export const FAKE_FAILURE_STATUS = 501;

export type Answer =
  | {
      readonly kind: 'respond';
      readonly httpStatus: number;
      readonly body: unknown;
      readonly retryAfter: string | null;
    }
  | { readonly kind: 'disconnect' }
  | { readonly kind: 'hang' };

/** Whether the SDK retries the attempt `answer` serves on a GET. */
export function isRetryableAnswer(answer: Answer): boolean {
  if (answer.kind === 'respond') return isRetryableStatus(answer.httpStatus);
  return true;
}

export function jsonResponse(
  httpStatus: number,
  body: unknown,
  retryAfter: string | null = null,
): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (retryAfter !== null) headers.set('retry-after', retryAfter);
  return new Response(JSON.stringify(body), { status: httpStatus, headers });
}

export function errorBody(error: unknown): unknown {
  return { result: null, error };
}

export function respond(
  httpStatus: number,
  body: unknown,
  retryAfter: string | null = null,
): Answer {
  return { kind: 'respond', httpStatus, body, retryAfter };
}

/** The success answer for `payload`, or the endpoint's not-found error for `MISS`. */
export function replyAnswer(endpoint: Endpoint, payload: unknown): Answer {
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
export function failureAnswer(code: PaylovErrorCode, failure: PaylovFakeFailure): Answer {
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

export async function respondWith(
  answer: Answer,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (answer.kind === 'disconnect') throw new TypeError('fetch failed');
  if (answer.kind === 'hang') return await neverAnswered(signal);
  return jsonResponse(answer.httpStatus, answer.body, answer.retryAfter);
}
