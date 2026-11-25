import { describe, expect, it } from 'vitest';

import { ENDPOINTS as CARD_ENDPOINTS } from '../../src/cards/resource.js';
import { ENDPOINTS as AUTH_ENDPOINTS } from '../../src/core/auth.js';
import { normalizeResponse } from '../../src/core/envelope.js';
import type { Endpoint, EndpointEffect, ResponseContext } from '../../src/core/types.js';
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
  PaylovClientClosedError,
  PaylovConnectionError,
  PaylovProtocolError,
  abortedError,
  attemptFailure,
  beforeOperation,
  clientClosedError,
  invalidInput,
  isPaylovApiError,
  isPaylovError,
  isPaylovOutcomeUnknown,
  malformedResponse,
  synthesizedMiss,
  unexpectedStatus,
} from '../../src/core/errors.js';
import { recordOf } from '../helpers/asserts.js';

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
      isOutcomeUnknown: false,
    });
    expect(
      new PaylovApiError({
        code: 'processing_error',
        httpStatus: 400,
        endpoint: ENDPOINT,
        isOutcomeUnknown: true,
      }).toJSON(),
    ).toMatchObject({ isOutcomeUnknown: true });
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
      isOutcomeUnknown: false,
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
  it('reads isOutcomeUnknown, which a caller-built error defaults to false', () => {
    const unknownOutcomes = [
      new PaylovApiError({
        code: 'x',
        httpStatus: 400,
        endpoint: ENDPOINT,
        isOutcomeUnknown: true,
      }),
      new PaylovProtocolError({
        code: 'sdk_malformed_response',
        httpStatus: 200,
        endpoint: ENDPOINT,
        isOutcomeUnknown: true,
      }),
      new PaylovConnectionError({
        code: 'sdk_timeout',
        endpoint: ENDPOINT,
        isSent: true,
        isOutcomeUnknown: true,
      }),
    ];
    const knownOutcomes = [
      invalidInput('m', 'f', 'type'),
      clientClosedError(),
      new PaylovApiError({ code: 'server_error', httpStatus: 500, endpoint: ENDPOINT }),
      new PaylovProtocolError({
        code: 'sdk_unexpected_status',
        httpStatus: 502,
        endpoint: ENDPOINT,
      }),
      new PaylovConnectionError({ code: 'sdk_network_error', endpoint: ENDPOINT, isSent: true }),
    ];
    expect(unknownOutcomes.map(isPaylovOutcomeUnknown)).toEqual(unknownOutcomes.map(() => true));
    expect(knownOutcomes.map(isPaylovOutcomeUnknown)).toEqual(knownOutcomes.map(() => false));
    expect(isPaylovOutcomeUnknown(new Error('not from the SDK'))).toBe(false);
    expect(isPaylovOutcomeUnknown({ kind: 'api', isOutcomeUnknown: true })).toBe(false);
  });
});

function contextOf(effect: EndpointEffect, httpStatus: number): ResponseContext {
  return { endpoint: ENDPOINT, httpStatus, effect };
}

function gatewayAnswer(effect: EndpointEffect, httpStatus: number, code: string): unknown {
  const body = { result: null, error: { code, message: 'declined' } };
  const normalized = normalizeResponse(body, contextOf(effect, httpStatus), 'envelope', null);
  return normalized.kind === 'failure' ? normalized.error : normalized.payload;
}

describe('outcome of a failed operation by its effect', () => {
  const EFFECTS: readonly EndpointEffect[] = ['read', 'write', 'money'];
  const failures: Readonly<Record<string, (effect: EndpointEffect) => unknown>> = {
    'HTTP 500': (effect) => gatewayAnswer(effect, 500, 'server_error'),
    'HTTP 503 without an error body': (effect) => unexpectedStatus(contextOf(effect, 503)),
    'a malformed success': (effect) => malformedResponse(contextOf(effect, 200), 'result'),
    'a connection failure once sent': (effect) =>
      attemptFailure('sdk_network_error', ENDPOINT, effect),
    'an abort in flight': (effect) => attemptFailure('sdk_aborted', ENDPOINT, effect),
    'a generic failure code': (effect) => gatewayAnswer(effect, 400, 'processing_error'),
    'a specific decline': (effect) => gatewayAnswer(effect, 400, 'insufficient_funds'),
    'a decoded miss': (effect) => synthesizedMiss(contextOf(effect, 200), 'card_not_found'),
    'an abort before fetch': () => abortedError(ENDPOINT, true),
  };

  it('is never unknown for a read, unknown for a write after a 5xx, protocol or sent failure, and also after a generic code for money', () => {
    const unknownEffects = Object.fromEntries(
      Object.entries(failures).map(([failure, build]) => [
        failure,
        EFFECTS.filter((effect) => isPaylovOutcomeUnknown(build(effect))),
      ]),
    );
    expect(unknownEffects).toEqual({
      'HTTP 500': ['write', 'money'],
      'HTTP 503 without an error body': ['write', 'money'],
      'a malformed success': ['write', 'money'],
      'a connection failure once sent': ['write', 'money'],
      'an abort in flight': ['write', 'money'],
      'a generic failure code': ['money'],
      'a specific decline': [],
      'a decoded miss': [],
      'an abort before fetch': [],
    });
  });

  // docs/architecture.md names the generic codes that leave a money operation ambiguous.
  it.each(['processing_error', 'unknown_error', 'error_at_pay'])(
    'reads %s as unknown from a money endpoint only',
    (code) => {
      expect(
        EFFECTS.filter((effect) => isPaylovOutcomeUnknown(gatewayAnswer(effect, 400, code))),
      ).toEqual(['money']);
    },
  );
});

describe('beforeOperation', () => {
  it('copies an unknown-outcome grant failure as a known one, leaving the shared error intact', () => {
    const shared = [
      gatewayErrorOf(503),
      new PaylovProtocolError({
        code: 'sdk_unexpected_status',
        httpStatus: 503,
        endpoint: TOKEN_ENDPOINT,
        isOutcomeUnknown: true,
      }),
      attemptFailure('sdk_timeout', TOKEN_ENDPOINT, 'write', 50),
    ];
    for (const error of shared) {
      const seen = beforeOperation(error);
      expect(seen).not.toBe(error);
      expect(seen).toBeInstanceOf(error.constructor);
      expect(isPaylovOutcomeUnknown(seen)).toBe(false);
      expect(isPaylovOutcomeUnknown(error)).toBe(true);
      expect(isPaylovError(seen) ? seen.toJSON() : seen).toEqual({
        ...error.toJSON(),
        isOutcomeUnknown: false,
      });
    }
  });

  it('copies a known grant failure too, its fields included, and passes foreign errors through', () => {
    const rejected = new PaylovApiError({
      code: 'validation_error',
      httpStatus: 400,
      endpoint: TOKEN_ENDPOINT,
      fields: ['username'],
    });
    const seen = beforeOperation(rejected);
    expect(seen).toBeInstanceOf(PaylovApiError);
    expect(seen).not.toBe(rejected);
    expect(recordOf(seen)['fields']).not.toBe(rejected.fields);
    expect(isPaylovError(seen) ? seen.toJSON() : seen).toEqual(rejected.toJSON());
    const closed = clientClosedError();
    expect(beforeOperation(closed)).not.toBe(closed);
    expect(beforeOperation(closed)).toBeInstanceOf(PaylovClientClosedError);
    const foreign = new Error('not from the SDK');
    expect(beforeOperation(foreign)).toBe(foreign);
  });
});

const TOKEN_ENDPOINT = 'POST /merchant/oauth2/token/';

function gatewayErrorOf(httpStatus: number): PaylovApiError {
  return new PaylovApiError({
    code: 'server_error',
    httpStatus,
    endpoint: TOKEN_ENDPOINT,
    retryAfterSeconds: 5,
    isOutcomeUnknown: true,
  });
}

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

describe('endpoint effects', () => {
  it('declare money only where funds move and read only where nothing changes', () => {
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
    const byEffect: Record<EndpointEffect, string[]> = { read: [], write: [], money: [] };
    for (const [feature, table] of Object.entries(tables)) {
      for (const [name, endpoint] of Object.entries(table)) {
        byEffect[endpoint.effect].push(`${feature}.${name}`);
      }
    }
    expect(byEffect.money.toSorted()).toEqual([
      'holds.capture',
      'holds.create',
      'holds.release',
      'payments.confirmPanPayment',
      'payments.pay',
      'payments.refund',
      'splits.create',
    ]);
    expect(byEffect.read.toSorted()).toEqual([
      'cards.checkPhone',
      'cards.get',
      'cards.list',
      'fiscalization.checkActivityType',
      'fiscalization.getReceipt',
      'gateway.getStatus',
      'gateway.listBanks',
      'holds.get',
      'onboarding.checkToken',
      'splits.get',
      'transactions.getRrn',
      'transactions.getTransactions',
    ]);
  });
});
