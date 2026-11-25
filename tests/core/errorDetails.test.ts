import { describe, expect, it } from 'vitest';

import { decodeErrorDetails } from '../../src/core/errorDetails.js';
import { isPaylovOutcomeUnknown } from '../../src/core/errors.js';
import { ENDPOINTS as PAYMENT_ENDPOINTS } from '../../src/payments/resource.js';
import { expectApiError, expectNoSecretLeak, recordOf } from '../helpers/asserts.js';
import { loadWire } from '../helpers/fixtures.js';
import { client, rawPayload } from './httpCases.js';

const SECRET = 'EXAMPLE-GATEWAY-MESSAGE-NOT-A-REAL-VALUE';

function decode(
  code: string,
  error: Readonly<Record<string, unknown>>,
  retryAfter: string | null = null,
  httpStatus = 400,
): ReturnType<typeof decodeErrorDetails> {
  return decodeErrorDetails(code, error, httpStatus, retryAfter);
}

/** `['x']` wrapped in `levels` objects under the key `a`. */
function nestedUnderA(levels: number): unknown {
  return Array.from({ length: levels }).reduce<unknown>((child) => ({ a: child }), ['x']);
}

describe('fields', () => {
  it('flattens validation_error data into wire paths, never messages', () => {
    const details = decode('validation_error', {
      message: SECRET,
      data: {
        amount: [SECRET],
        items: [{ title: [SECRET] }, 'skip', { price: [SECRET], count: [SECRET] }],
        account: { order_id: [SECRET] },
      },
    });
    expect(details).toEqual({
      fields: ['amount', 'items.0.title', 'items.2.price', 'items.2.count', 'account.order_id'],
    });
    expectNoSecretLeak(details, [SECRET]);
  });

  it('drops keys that are not identifiers, including a top-level JSON offset', () => {
    expect(
      decode('validation_error', {
        data: { 'bad key': ['x'], ['a'.repeat(65)]: ['x'] },
      }),
    ).toEqual({});
    const { body } = loadWire('auth/token.jsonOffset.wire.json');
    const jsonOffset = recordOf(recordOf(body)['error']);
    expect(decode('validation_error', jsonOffset)).toEqual({});
    expect(decode('validation_error', { data: null })).toEqual({});
    expect(decode('validation_error', { data: ['x'] })).toEqual({});
  });

  it('keeps at most 32 paths', () => {
    const data = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`f${index}`, ['x']]));
    expect(decode('validation_error', { data }).fields).toHaveLength(32);
  });

  it('discards branches nested deeper than 16 segments', () => {
    expect(
      decode('validation_error', { data: { kept: nestedUnderA(15), dropped: nestedUnderA(16) } }),
    ).toEqual({
      fields: [`kept${'.a'.repeat(15)}`],
    });
  });

  it('keeps the gateway error of a payment whose validation data nests too deep to walk', async () => {
    const levels = 20_000;
    const data = `${'{"a":'.repeat(levels)}["x"]${'}'.repeat(levels)}`;
    const rawBody = `{"result":null,"error":{"code":"validation_error","data":${data}}}`;
    const { http } = client([{ status: 500, rawBody }]);
    const error = await expectApiError(http.request(PAYMENT_ENDPOINTS.pay, {}, rawPayload), {
      code: 'validation_error',
      httpStatus: 500,
    });
    expect(isPaylovOutcomeUnknown(error)).toBe(true);
  });

  it('reads field_not_valid from data.field or a bare data string', () => {
    expect(decode('field_not_valid', { data: { field: 'items.0.vat_percent' } })).toEqual({
      fields: ['items.0.vat_percent'],
    });
    expect(decode('field_not_valid', { data: 'phone' })).toEqual({
      fields: ['phone'],
    });
    expect(decode('field_not_valid', { data: { field: SECRET.toLowerCase() } })).toEqual({});
    expect(decode('field_not_valid', { data: '0.title' })).toEqual({});
  });

  it('reads field_required from data.field, never from its message', () => {
    expect(decode('field_required', { data: { field: 'serviceId' } })).toEqual({
      fields: ['serviceId'],
    });
    expect(decode('field_required', { message: 'field_required: serviceId' })).toEqual({});
  });

  it('ignores field data on other codes', () => {
    expect(decode('insufficient_funds', { data: { amount: ['x'] } })).toEqual({});
  });
});

describe('messages', () => {
  it('derives no detail from an invalid_grant or permission_denied message', () => {
    expect(decode('invalid_grant', { message: 'Invalid credentials' })).toEqual({});
    expect(decode('permission_denied', { message: 'permission_denied' })).toEqual({});
  });
});

describe('retryAfterSeconds', () => {
  it('reads a delta-seconds Retry-After header', () => {
    const { headers, body } = loadWire('auth/token.rateLimitedRetryAfter.wire.json');
    const error = recordOf(recordOf(body)['error']);
    const header = headers['retry-after'] ?? null;
    expect(decode('rate_limit_exceeded', error, header)).toEqual({ retryAfterSeconds: 48 });
    expect(decode('rate_limit_exceeded', {}, ' 30 ')).toEqual({ retryAfterSeconds: 30 });
    expect(decode('rate_limit_exceeded', {}, '3600')).toEqual({ retryAfterSeconds: 3600 });
  });

  it.each(['0', '3601', 'Wed, 21 Oct 2026 07:28:00 GMT', '1.5', ''])(
    'reports no delay for a Retry-After of %j, whatever the message says',
    (header) => {
      expect(decode('rate_limit_exceeded', { message: 'Retry after 9s' }, header)).toEqual({});
    },
  );

  it('ignores the delay in a message without the header', () => {
    expect(
      decode('rate_limit_exceeded', { message: 'Too many requests. Retry after 42s.' }),
    ).toEqual({});
  });

  it('prefers a 429 Retry-After header to a card block delay, which counts at other statuses', () => {
    const blocked = { data: { sec_to_retry: 2 } };
    expect(decode('card_is_blocked', blocked, '48', 429)).toEqual({ retryAfterSeconds: 48 });
    expect(decode('card_is_blocked', blocked, null, 429)).toEqual({ retryAfterSeconds: 2 });
    expect(decode('card_is_blocked', blocked, '48', 400)).toEqual({ retryAfterSeconds: 2 });
    expect(decode('invalid_grant', {}, '48', 429)).toEqual({ retryAfterSeconds: 48 });
  });

  it('reads the rest of a card block from card_is_blocked data', () => {
    const { body } = loadWire('cards/confirmPanBinding.cardBlocked.wire.json');
    expect(decode('card_is_blocked', recordOf(recordOf(body)['error']))).toEqual({
      retryAfterSeconds: 298,
    });
    for (const data of [
      { sec_to_retry: 0 },
      { sec_to_retry: '298' },
      { sec_to_retry: 1.5 },
      null,
    ]) {
      expect(decode('card_is_blocked', { data })).toEqual({});
    }
  });

  it('is read for rate_limit_exceeded and card_is_blocked only', () => {
    expect(decode('server_error', { message: 'Retry after 5s' }, '5')).toEqual({});
    expect(decode('card_is_blocked_in_processing_center', { data: { sec_to_retry: 5 } })).toEqual(
      {},
    );
  });
});
