import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PaylovApiError,
  PaylovConnectionError,
  PaylovProtocolError,
  abortedError,
  clientClosedError,
  invalidInput,
  isPaylovApiError,
  isPaylovError,
  isPaylovOutcomeUnknown,
} from '../../src/core/errors.js';

const ENDPOINT = 'POST /merchant/receipts/create/';

describe('error classes', () => {
  it('each origin has its own class, kind and name', () => {
    const errors = [
      invalidInput('cards.create: cardNumber is required', 'cardNumber', 'required'),
      clientClosedError(),
      new PaylovApiError({ code: 'insufficient_funds', httpStatus: 400, endpoint: ENDPOINT }),
      new PaylovProtocolError({
        code: 'sdk_malformed_response',
        httpStatus: 200,
        endpoint: ENDPOINT,
      }),
      new PaylovConnectionError({ code: 'sdk_network_error', endpoint: ENDPOINT, isSent: true }),
    ];
    expect(errors.map((error) => [error.name, error.kind])).toEqual([
      ['PaylovInputError', 'input'],
      ['PaylovClientClosedError', 'closed'],
      ['PaylovApiError', 'api'],
      ['PaylovProtocolError', 'protocol'],
      ['PaylovConnectionError', 'connection'],
    ]);
    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(isPaylovError(error)).toBe(true);
      expect(error.cause).toBeUndefined();
    }
    expect(isPaylovError(new Error('x'))).toBe(false);
  });

  it('messages carry only static metadata', () => {
    expect(
      new PaylovApiError({ code: 'not_found', httpStatus: 404, endpoint: ENDPOINT }).message,
    ).toBe(`Paylov returned not_found (HTTP 404) for ${ENDPOINT}`);
    expect(
      new PaylovProtocolError({
        code: 'sdk_malformed_response',
        httpStatus: 200,
        endpoint: ENDPOINT,
        path: 'result.id',
      }).message,
    ).toBe(`Paylov response for ${ENDPOINT} has an unexpected shape at "result.id"`);
    expect(
      new PaylovProtocolError({
        code: 'sdk_unexpected_status',
        httpStatus: 502,
        endpoint: ENDPOINT,
      }).message,
    ).toBe(`Paylov returned HTTP 502 for ${ENDPOINT} without a usable error body`);
    expect(
      new PaylovConnectionError({
        code: 'sdk_timeout',
        endpoint: ENDPOINT,
        isSent: true,
        timeoutMs: 500,
      }).message,
    ).toBe('Paylov request timed out after 500 ms');
    expect(abortedError(ENDPOINT, false).message).toBe(
      'Paylov request was aborted by the caller before it was sent',
    );
  });
});

describe('toJSON', () => {
  it('returns allowlisted metadata, with absent details undefined', () => {
    expect(
      new PaylovApiError({
        code: 'validation_error',
        httpStatus: 400,
        endpoint: ENDPOINT,
        fields: ['items.0.title'],
      }).toJSON(),
    ).toEqual({
      name: 'PaylovApiError',
      kind: 'api',
      code: 'validation_error',
      message: `Paylov returned validation_error (HTTP 400) for ${ENDPOINT}`,
      httpStatus: 400,
      endpoint: ENDPOINT,
      fields: ['items.0.title'],
    });
    expect(
      new PaylovApiError({
        code: 'rate_limit_exceeded',
        httpStatus: 429,
        endpoint: ENDPOINT,
        retryAfterSeconds: 42,
      }).toJSON(),
    ).toMatchObject({ retryAfterSeconds: 42 });
    expect(invalidInput('m', 'f', 'type').toJSON()).toEqual({
      name: 'PaylovInputError',
      kind: 'input',
      code: 'sdk_invalid_input',
      message: 'm',
      field: 'f',
      rule: 'type',
    });
    expect(clientClosedError().toJSON()).toEqual({
      name: 'PaylovClientClosedError',
      kind: 'closed',
      code: 'sdk_client_closed',
      message: 'PaylovClient is closed; create a new client',
    });
    expect(
      new PaylovProtocolError({
        code: 'sdk_malformed_response',
        httpStatus: 200,
        endpoint: ENDPOINT,
        path: 'result',
      }).toJSON(),
    ).toMatchObject({ httpStatus: 200, endpoint: ENDPOINT, path: 'result' });
    expect(abortedError(ENDPOINT, true).toJSON()).toEqual({
      name: 'PaylovConnectionError',
      kind: 'connection',
      code: 'sdk_aborted',
      message: 'Paylov request was aborted by the caller',
      endpoint: ENDPOINT,
      isSent: true,
    });
    expect(
      new PaylovConnectionError({
        code: 'sdk_timeout',
        endpoint: ENDPOINT,
        isSent: true,
        timeoutMs: 5,
      }).toJSON(),
    ).toMatchObject({ timeoutMs: 5 });
  });

  it('is what JSON.stringify writes', () => {
    const error = new PaylovApiError({ code: 'not_found', httpStatus: 404, endpoint: ENDPOINT });
    expect(JSON.parse(JSON.stringify(error))).toEqual(error.toJSON());
  });
});

describe('isPaylovOutcomeUnknown', () => {
  it('is true where a POST may have executed, false where it cannot have', () => {
    const api = (httpStatus: number): PaylovApiError =>
      new PaylovApiError({ code: 'server_error', httpStatus, endpoint: ENDPOINT });
    const unknownOutcomes = [
      new PaylovConnectionError({
        code: 'sdk_timeout',
        endpoint: ENDPOINT,
        isSent: true,
        timeoutMs: 5,
      }),
      abortedError(ENDPOINT, true),
      new PaylovProtocolError({
        code: 'sdk_malformed_response',
        httpStatus: 200,
        endpoint: ENDPOINT,
      }),
      api(500),
      api(503),
    ];
    const knownOutcomes = [
      invalidInput('m', 'f', 'type'),
      clientClosedError(),
      abortedError(ENDPOINT, false),
      api(400),
      api(429),
      api(499),
    ];
    expect(unknownOutcomes.map(isPaylovOutcomeUnknown)).toEqual(unknownOutcomes.map(() => true));
    expect(knownOutcomes.map(isPaylovOutcomeUnknown)).toEqual(knownOutcomes.map(() => false));
    expect(isPaylovOutcomeUnknown(new Error('not from the SDK'))).toBe(false);
  });
});

describe('isPaylovApiError', () => {
  const error: unknown = new PaylovApiError({
    code: 'insufficient_funds',
    httpStatus: 400,
    endpoint: ENDPOINT,
  });

  it('matches any API error without codes and the listed codes with them', () => {
    expect(isPaylovApiError(error)).toBe(true);
    expect(isPaylovApiError(error, 'insufficient_funds')).toBe(true);
    expect(isPaylovApiError(error, 'card_not_found', 'insufficient_funds')).toBe(true);
    expect(isPaylovApiError(error, 'card_not_found')).toBe(false);
    expect(isPaylovApiError(invalidInput('m', 'f', 'type'))).toBe(false);
    expect(isPaylovApiError({ code: 'insufficient_funds' })).toBe(false);
  });

  it('narrows the code to the listed literals', () => {
    if (isPaylovApiError(error, 'card_not_found', 'insufficient_funds')) {
      expectTypeOf(error.code).toEqualTypeOf<'card_not_found' | 'insufficient_funds'>();
    }
  });
});
