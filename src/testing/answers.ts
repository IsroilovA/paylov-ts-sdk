/** The fake gateway's HTTP answers, built so the SDK decodes each back into what was scripted. */

import { isWireErrorCode } from '../core/envelope.js';
import type { PaylovErrorCode } from '../core/errorCodes.js';
import { decodeErrorDetails } from '../core/errorDetails.js';
import {
  encodeErrorDetails,
  FakeRefusal,
  type FakeMethodSpec,
  type PaylovFakeFailure,
} from '../core/fake.js';
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

/** The success answer for `payload` at `httpStatus`, or the error a `FakeRefusal` names. */
export function replyAnswer(endpoint: Endpoint, payload: unknown, httpStatus = 200): Answer {
  if (payload instanceof FakeRefusal) return failureAnswer(payload.code, {});
  const body = endpoint.shape === 'envelope' ? { result: payload, error: null } : payload;
  return respond(httpStatus, body);
}

/** The method's success answer for `result`, at the status its spec declares. */
export function successAnswer<T>(spec: FakeMethodSpec<T, unknown>, result: T): Answer {
  return replyAnswer(spec.endpoint, spec.encode(result), spec.successStatus);
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
  const { error, retryAfter } = encodeErrorDetails(code, httpStatus, failure);
  const reported = decodeErrorDetails(code, error, httpStatus, retryAfter);
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

/**
 * How `spec`'s method reports `code`: its success-body miss for the code it reads as a miss, else
 * a gateway error. A success-body miss carries no failure details.
 */
export function methodFailureAnswer(
  spec: Pick<FakeMethodSpec<never, unknown>, 'endpoint' | 'miss'>,
  code: PaylovErrorCode,
  failure: PaylovFakeFailure,
): Answer {
  const { miss } = spec;
  if (miss?.code !== code) return failureAnswer(code, failure);
  const { httpStatus, fields, retryAfterSeconds } = failure;
  if (httpStatus !== undefined || fields !== undefined || retryAfterSeconds !== undefined) {
    throw new TypeError(`the gateway reports ${code} here as an HTTP 200 answer without details`);
  }
  return replyAnswer(spec.endpoint, miss.payload);
}

export async function respondWith(
  answer: Answer,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (answer.kind === 'disconnect') throw new TypeError('fetch failed');
  if (answer.kind === 'hang') return await neverAnswered(signal);
  return jsonResponse(answer.httpStatus, answer.body, answer.retryAfter);
}

/** Not a gateway or SDK code, so a state the simulation does not cover never reads as Paylov's. */
export const UNSIMULATED_CODE = 'fake_unsimulated';

/** The answer to a state the simulation does not cover; the message never carries a value. */
export function unsimulatedAnswer(label: string, reason: string): Answer {
  const message = `the simulation does not cover ${label}: ${reason}`;
  return respond(FAKE_FAILURE_STATUS, errorBody({ code: UNSIMULATED_CODE, message }));
}
