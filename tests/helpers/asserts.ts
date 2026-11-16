import { expect } from 'vitest';

import { isRecord } from '../../src/core/decoding.js';
import {
  isPaylovError,
  PaylovApiError,
  PaylovInputError,
  PaylovProtocolError,
  type PaylovInputRule,
} from '../../src/core/errors.js';

/** Narrows an unknown test result after proving it is a non-array object. */
export function recordOf(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error('expected an object result');
}

/** Runs `fn` and returns the thrown value, failing the test when nothing is thrown. */
export function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

/** Awaits `promise` and returns its rejection, failing the test when it resolves. */
export async function captureAsync(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

/** Captures the rejection of a promise or the throw of a synchronous call. */
function captureRejection(action: Promise<unknown> | (() => unknown)): Promise<unknown> {
  return typeof action === 'function' ? Promise.resolve(capture(action)) : captureAsync(action);
}

function collectReachableValues(value: unknown, seen: WeakSet<object>, parts: string[]): void {
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'string') parts.push(key);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      continue;
    }
    if (descriptor !== undefined && 'value' in descriptor) {
      collectReachableValues(descriptor.value, seen, parts);
    }
  }
}

/**
 * Asserts that none of `secrets` is reachable from the thrown object, including enumerable
 * custom properties, non-enumerable `Error.cause`, nested errors and cyclic graphs.
 */
export function expectNoSecretLeak(error: unknown, secrets: readonly string[]): void {
  const parts: string[] = [];
  try {
    parts.push(JSON.stringify(error));
  } catch {
    // Cyclic graphs are covered by the walker below.
  }
  parts.push(String(error));
  collectReachableValues(error, new WeakSet<object>(), parts);
  if (error instanceof Error) {
    parts.push(error.message, error.stack ?? '');
  }
  if (isPaylovError(error)) {
    parts.push(JSON.stringify(error.toJSON()));
  }
  const haystack = parts.join('\n');
  for (const secret of secrets) {
    expect(haystack).not.toContain(secret);
  }
}

/** The documented `Basic base64(key:secret)` header, for asserting what went on the wire. */
export function basicAuthHeader(key: string, secret: string): string {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

/** The expected gateway rejection; omitted `fields` mean the error has none. */
export interface ExpectedApiError {
  readonly code: string;
  readonly httpStatus?: number;
  readonly fields?: readonly string[] | undefined;
}

/**
 * Captures a gateway rejection and asserts its code, HTTP status and `fields` exactly.
 *
 * @example
 * const error = await expectApiError(cards.get({ cardId }), { code: 'card_not_found' });
 */
export async function expectApiError(
  action: Promise<unknown> | (() => unknown),
  { code, httpStatus = 400, fields }: ExpectedApiError,
): Promise<PaylovApiError> {
  const error = await captureRejection(action);
  if (!(error instanceof PaylovApiError))
    throw new Error(`expected a PaylovApiError: ${String(error)}`);
  expect({
    code: error.code,
    httpStatus: error.httpStatus,
    fields: error.fields,
  }).toEqual({ code, httpStatus, fields });
  return error;
}

/**
 * Captures an `sdk_malformed_response` and asserts its path exactly, `undefined` included.
 *
 * @example
 * await expectMalformed(cards.delete({ cardId }), 'result');
 */
export async function expectMalformed(
  action: Promise<unknown> | (() => unknown),
  path: string | undefined,
): Promise<PaylovProtocolError> {
  const error = await captureRejection(action);
  if (!(error instanceof PaylovProtocolError)) {
    throw new Error(`expected a PaylovProtocolError: ${String(error)}`);
  }
  expect(error.code).toBe('sdk_malformed_response');
  expect(error.path).toBe(path);
  return error;
}

/** The expected refusal; `field` is compared exactly, so pass `undefined` for a whole-input error. */
export interface ExpectedInputError {
  readonly code?: string;
  readonly field: string | undefined;
  readonly rule: PaylovInputRule;
}

/**
 * Captures a local input refusal (thrown or rejected) and asserts its code, field and rule exactly.
 *
 * @example
 * await expectInputError(cards.get({ cardId: '../x' }), { field: 'cardId', rule: 'format' });
 */
export async function expectInputError(
  action: Promise<unknown> | (() => unknown),
  { code = 'sdk_invalid_input', field, rule }: ExpectedInputError,
): Promise<PaylovInputError> {
  const error = await captureRejection(action);
  if (!(error instanceof PaylovInputError))
    throw new Error(`expected a PaylovInputError: ${String(error)}`);
  expect({ code: error.code, field: error.field, rule: error.rule }).toEqual({ code, field, rule });
  return error;
}
