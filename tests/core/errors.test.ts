import { describe, expect, it } from 'vitest';

import { ENDPOINTS as CARD_ENDPOINTS } from '../../src/cards/resource.js';
import { ENDPOINTS as AUTH_ENDPOINTS } from '../../src/core/auth.js';
import { normalizeResponse } from '../../src/core/envelope.js';
import type { Endpoint } from '../../src/core/types.js';
import { ENDPOINTS as FISCALIZATION_ENDPOINTS } from '../../src/fiscalization/resource.js';
import { ENDPOINTS as GATEWAY_ENDPOINTS } from '../../src/gateway/resource.js';
import { ENDPOINTS as HOLD_ENDPOINTS } from '../../src/holds/resource.js';
import { ENDPOINTS as ONBOARDING_ENDPOINTS } from '../../src/onboarding/client.js';
import { ENDPOINTS as PAYMENT_ENDPOINTS } from '../../src/payments/resource.js';
import { ENDPOINTS as SPLIT_ENDPOINTS } from '../../src/splits/resource.js';
import { ENDPOINTS as SUB_MERCHANT_ENDPOINTS } from '../../src/subMerchants/resource.js';
import { ENDPOINTS as TRANSACTION_ENDPOINTS } from '../../src/transactions/resource.js';
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
import { capture } from '../helpers/asserts.js';

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
      isUnsettled: false,
    });
    expect(
      new PaylovApiError({
        code: 'processing_error',
        httpStatus: 400,
        endpoint: ENDPOINT,
        isUnsettled: true,
      }).toJSON(),
    ).toMatchObject({ isUnsettled: true });
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

function apiErrorOf(code: string, isUnsettled: boolean): PaylovApiError {
  return new PaylovApiError({ code, httpStatus: 400, endpoint: ENDPOINT, isUnsettled });
}

describe('isPaylovOutcomeUnknown for a 4xx gateway error', () => {
  it('reads the error as unknown exactly when the endpoint left it unsettled', () => {
    expect(isPaylovOutcomeUnknown(apiErrorOf('processing_error', true))).toBe(true);
    expect(isPaylovOutcomeUnknown(apiErrorOf('processing_error', false))).toBe(false);
  });

  it('counts HTTP 500 and above as unsettled for any code', () => {
    const error = new PaylovApiError({ code: 'server_error', httpStatus: 502, endpoint: ENDPOINT });
    expect(error.isUnsettled).toBe(true);
    expect(isPaylovOutcomeUnknown(error)).toBe(true);
  });

  it('defaults isUnsettled to false for an error built without it', () => {
    const error = new PaylovApiError({
      code: 'processing_error',
      httpStatus: 400,
      endpoint: ENDPOINT,
    });
    expect(error.isUnsettled).toBe(false);
    expect(isPaylovOutcomeUnknown(error)).toBe(false);
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
});

describe('unsettled codes', () => {
  it('leave exactly the money-moving operations unknown', () => {
    const tables: Readonly<Record<string, Readonly<Record<string, Endpoint>>>> = {
      cards: CARD_ENDPOINTS,
      fiscalization: FISCALIZATION_ENDPOINTS,
      gateway: GATEWAY_ENDPOINTS,
      holds: HOLD_ENDPOINTS,
      payments: PAYMENT_ENDPOINTS,
      splits: SPLIT_ENDPOINTS,
      subMerchants: SUB_MERCHANT_ENDPOINTS,
      transactions: TRANSACTION_ENDPOINTS,
      onboarding: ONBOARDING_ENDPOINTS,
      auth: AUTH_ENDPOINTS,
    };
    const generic = ['processing_error', 'unknown_error', 'error_at_pay'];
    const specific = ['insufficient_funds', 'hold_time_expired', 'transaction_already_payed'];
    const unsettledCodesOf = (endpoint: Endpoint): string[] =>
      [...generic, ...specific].filter((code) => {
        const body = { result: null, error: { code, message: 'declined' } };
        const error = capture(() =>
          normalizeResponse(body, { endpoint: ENDPOINT, httpStatus: 400 }, endpoint, null),
        );
        return error instanceof PaylovApiError && error.isUnsettled;
      });
    const declared = Object.fromEntries(
      Object.entries(tables).flatMap(([feature, table]) =>
        Object.entries(table).flatMap(([name, endpoint]) => {
          const codes = unsettledCodesOf(endpoint);
          return codes.length === 0 ? [] : [[`${feature}.${name}`, codes]];
        }),
      ),
    );
    expect(declared).toEqual({
      'holds.capture': generic,
      'holds.create': generic,
      'holds.release': generic,
      'payments.confirmPanPayment': generic,
      'payments.pay': generic,
      'payments.refund': generic,
      'splits.splitPayment': generic,
    });
  });
});
