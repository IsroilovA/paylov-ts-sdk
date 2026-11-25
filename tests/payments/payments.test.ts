import { describe, expect, it } from 'vitest';

import { isPaylovOutcomeUnknown } from '../../src/core/errors.js';
import { createPaymentsResource } from '../../src/payments/resource.js';
import {
  captureAsync,
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
} from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { fixtureResponse, patchedResponse, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

const TRANSACTION_ID = '5eed0000-0000-4000-8000-000000000001';
const CARD_ID = '5eed0000-0000-4000-8000-000000000002';
const PAN_TRANSACTION_ID = '5eed0000-0000-4000-8000-000000000005';
const USER_ID = 'user-example-1';
const PAN = 'PAN-FROM-SECURE-INPUT';
const EXPIRE_DATE = '9912';
const OTP = 'OTP-FROM-SMS-EXAMPLE';

function setup(script: FakeResponseSpec[]) {
  return setupResource(createPaymentsResource, script);
}

/** A wire fixture whose `result` is replaced, for malformed-success cases. */
function withResult(fixture: string, result: unknown): FakeResponseSpec {
  return patchedResponse(fixture, [], (body) => ({ ...body, result }));
}

const startPanParams = {
  cardNumber: PAN,
  cardExpiry: EXPIRE_DATE,
  amountTiyin: 120_000,
  account: { order_id: 'A-1025' },
};

describe('payments.create', () => {
  it('posts whole SUM with the account and returns the transaction id', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/create.success.wire.json')]);

    const created = await resource.create({
      amountTiyin: 100_000,
      account: { order_id: 'A-1024' },
      userId: USER_ID,
    });

    expect(created).toEqual({ transactionId: TRANSACTION_ID });
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]?.method).toBe('POST');
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/receipts/create/`);
    expect(fetchImpl.calls[0]?.body).toEqual({
      amount: 1000,
      account: { order_id: 'A-1024' },
      userId: USER_ID,
    });
  });

  it('omits userId when none is given and sends an omitted account as the required {}', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/create.success.wire.json')]);

    await resource.create({ amountTiyin: 100 });

    expect(fetchImpl.calls[0]?.body).toEqual({ amount: 1, account: {} });
  });

  it.each([
    ['a fraction of a SUM', 150, 'format'],
    ['missing', undefined, 'required'],
  ] as const)('rejects an amount that is %s before any request', async (_, amountTiyin, rule) => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(resource.create({ amountTiyin: amountTiyin as number, account: {} }), {
      code: 'sdk_invalid_amount',
      field: 'amountTiyin',
      rule,
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it.each([['a string', 'order-1', 'type']] as const)(
    'rejects an account that is %s before any request',
    async (_, account, rule) => {
      const { resource, fetchImpl } = setup([]);

      await expectInputError(
        resource.create({ amountTiyin: 100, account: account as unknown as Record<string, never> }),
        { field: 'account', rule },
      );
      expect(fetchImpl.calls).toHaveLength(0);
    },
  );

  it('rejects a blank userId before any request', async () => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(resource.create({ amountTiyin: 100, account: {}, userId: ' ' }), {
      field: 'userId',
      rule: 'required',
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('fails as malformed when the success carries no transaction id', async () => {
    const { resource } = setup([withResult('payments/create.success.wire.json', {})]);

    const error = await expectMalformed(
      resource.create({ amountTiyin: 100, account: {} }),
      'result.transactionId',
    );

    expect(error.endpoint).toBe('POST /merchant/receipts/create/');
  });
});

describe('payments.pay', () => {
  it('reads processing_error as an unknown outcome and a specific decline as definitive', async () => {
    const params = { transactionId: TRANSACTION_ID, cardId: CARD_ID, userId: USER_ID };
    const { resource } = setup([
      wireResponse('payments/pay.processingError.wire.json'),
      wireResponse('payments/pay.cardNotForCheck.wire.json'),
    ]);

    for (const [code, isUnsettled] of [
      ['processing_error', true],
      ['card_is_not_for_this_check', false],
    ] as const) {
      const error = await captureAsync(resource.pay(params));
      expect(error).toMatchObject({ code, isUnsettled });
      expect(isPaylovOutcomeUnknown(error)).toBe(isUnsettled);
    }
  });

  it('posts the transaction, card and user and returns the transaction id', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/pay.success.wire.json')]);

    const paid = await resource.pay({
      transactionId: TRANSACTION_ID,
      cardId: CARD_ID,
      userId: USER_ID,
    });

    expect(paid).toEqual({ transactionId: TRANSACTION_ID });
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/receipts/pay/`);
    expect(fetchImpl.calls[0]?.body).toEqual({
      transactionId: TRANSACTION_ID,
      cardId: CARD_ID,
      userId: USER_ID,
    });
  });

  it.each([
    ['transactionId', { transactionId: 42, cardId: CARD_ID, userId: USER_ID }, 'type'],
    ['cardId', { transactionId: TRANSACTION_ID, userId: USER_ID }, 'required'],
    ['userId', { transactionId: TRANSACTION_ID, cardId: CARD_ID }, 'required'],
  ] as const)(
    'rejects a missing or malformed %s before any request',
    async (field, params, rule) => {
      const { resource, fetchImpl } = setup([]);

      await expectInputError(resource.pay(params as never), { field, rule });
      expect(fetchImpl.calls).toHaveLength(0);
    },
  );
});

describe('gateway field errors', () => {
  it('sends a zero amount to Paylov, which names the rejected wire field', async () => {
    const { resource, fetchImpl } = setup([
      wireResponse('payments/create.fieldNotValid.wire.json'),
    ]);

    await expectApiError(resource.create({ amountTiyin: 0 }), {
      code: 'field_not_valid',
      fields: ['amount'],
    });
    expect(fetchImpl.calls[0]?.body).toEqual({ amount: 0, account: {} });
  });
});

describe('payments.refund', () => {
  it('reads processing_error as an unknown outcome', async () => {
    // DEV answered a refund of a captured hold with processing_error (c559).
    const { resource } = setup([
      fixtureResponse('payments/refund.processingError.synthesized.json', { status: 400 }),
    ]);

    const error = await captureAsync(resource.refund({ transactionId: TRANSACTION_ID }));
    expect(error).toMatchObject({ code: 'processing_error', isUnsettled: true });
    expect(isPaylovOutcomeUnknown(error)).toBe(true);
  });

  it('posts the transaction id and reads the Tashkent cancel time', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/refund.success.wire.json')]);

    const refunded = await resource.refund({ transactionId: TRANSACTION_ID });

    expect(refunded).toEqual({
      transactionId: TRANSACTION_ID,
      refundedAt: new Date('2026-11-12T20:54:08+05:00'),
    });
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/payment/cancel/`);
    expect(fetchImpl.calls[0]?.body).toEqual({ transactionId: TRANSACTION_ID });
  });

  it.each([['2026-11-12T20:54:08'], ['2026-02-30 10:00:00'], [null]])(
    'fails as malformed for the cancel time %j',
    async (cancelTime) => {
      const { resource } = setup([
        withResult('payments/refund.success.wire.json', {
          transactionId: TRANSACTION_ID,
          status: 'cancelled',
          cancelTime,
        }),
      ]);

      await expectMalformed(
        resource.refund({ transactionId: TRANSACTION_ID }),
        'result.cancelTime',
      );
    },
  );

  it('rejects a blank transaction id before any request', async () => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(resource.refund({ transactionId: ' ' }), {
      field: 'transactionId',
      rule: 'required',
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('payments.startPanPayment', () => {
  it('posts the card, whole SUM and account, never an extId, and returns the OTP phone', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/startPan.success.wire.json')]);

    const started = await resource.startPanPayment(startPanParams);

    expect(started).toEqual({
      transactionId: PAN_TRANSACTION_ID,
      otpSentPhone: '+9989*****00',
    });
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/paymentWithoutRegistration/`);
    expect(fetchImpl.calls[0]?.body).toEqual({
      cardNumber: PAN,
      expireDate: EXPIRE_DATE,
      amount: 1200,
      account: { order_id: 'A-1025' },
    });
  });

  it('sends an omitted account as the required {}', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/startPan.success.wire.json')]);

    await resource.startPanPayment({
      cardNumber: PAN,
      cardExpiry: EXPIRE_DATE,
      amountTiyin: 120_000,
    });

    expect(fetchImpl.calls[0]?.body).toEqual({
      cardNumber: PAN,
      expireDate: EXPIRE_DATE,
      amount: 1200,
      account: {},
    });
  });

  it.each([
    ['cardNumber', { cardNumber: ' ' }, 'sdk_invalid_input', 'required'],
    ['cardExpiry', { cardExpiry: 9912 }, 'sdk_invalid_input', 'type'],
    ['account', { account: 'order-1' }, 'sdk_invalid_input', 'type'],
    ['amountTiyin', { amountTiyin: 120_050 }, 'sdk_invalid_amount', 'format'],
  ] as const)('rejects an invalid %s before any request', async (field, patch, code, rule) => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(resource.startPanPayment({ ...startPanParams, ...patch } as never), {
      code,
      field,
      rule,
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('keeps the card number and expiry out of logger events and errors', async () => {
    const { resource, requests, responses } = setup([
      wireResponse('payments/startPan.cardNotFound.wire.json'),
    ]);

    const apiError = await expectApiError(resource.startPanPayment(startPanParams), {
      code: 'card_not_found',
    });
    const inputError = await expectInputError(
      resource.startPanPayment({
        ...startPanParams,
        cardExpiry: 'MM-YY-FROM-SECURE-INPUT',
        amountTiyin: 120_050,
      }),
      { code: 'sdk_invalid_amount', field: 'amountTiyin', rule: 'format' },
    );

    expectNoSecretLeak(apiError, [PAN, EXPIRE_DATE]);
    expectNoSecretLeak(inputError, [PAN, 'MM-YY-FROM-SECURE-INPUT']);
    const events = JSON.stringify([requests, responses]);
    expect(events).not.toContain(PAN);
    expect(events).not.toContain(EXPIRE_DATE);
  });
});

describe('payments.confirmPanPayment', () => {
  it('posts the transaction id and OTP and returns the transaction id', async () => {
    const { resource, fetchImpl, requests } = setup([
      wireResponse('payments/confirmPan.success.wire.json'),
    ]);

    const confirmed = await resource.confirmPanPayment({
      transactionId: PAN_TRANSACTION_ID,
      otp: OTP,
    });

    expect(confirmed).toEqual({ transactionId: PAN_TRANSACTION_ID });
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/confirmPayment/`);
    expect(fetchImpl.calls[0]?.body).toEqual({ transactionId: PAN_TRANSACTION_ID, otp: OTP });
    expect(JSON.stringify(requests)).not.toContain(OTP);
  });

  it('rejects a blank OTP before any request', async () => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(
      resource.confirmPanPayment({ transactionId: PAN_TRANSACTION_ID, otp: '' }),
      { field: 'otp', rule: 'required' },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
