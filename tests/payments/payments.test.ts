import { describe, expect, it } from 'vitest';

import { createPaymentsResource, type PaymentsResource } from '../../src/payments/resource.js';
import {
  captureAsync,
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
} from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { loadWire, wireResponse } from '../helpers/fixtures.js';
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
  const { status, body } = loadWire(fixture);
  return { status, body: { ...Object(body), result } };
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
    ['negative', -100, 'type'],
    ['not an integer', 100.5, 'type'],
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

  it.each([
    ['a string', 'order-1', 'type'],
    ['an array', [], 'type'],
  ] as const)('rejects an account that is %s before any request', async (_, account, rule) => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(
      resource.create({ amountTiyin: 100, account: account as unknown as Record<string, never> }),
      { field: 'account', rule },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

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

type Call = (resource: PaymentsResource) => Promise<unknown>;
const create: Call = (resource) => resource.create({ amountTiyin: 100 });
const createZero: Call = (resource) => resource.create({ amountTiyin: 0 });
const pay: Call = (resource) =>
  resource.pay({ transactionId: TRANSACTION_ID, cardId: CARD_ID, userId: USER_ID });

describe('gateway field errors', () => {
  it.each<[string, Call, string, string[]]>([
    ['create.fieldNotValid', createZero, 'field_not_valid', ['amount']],
    ['create.accountString', create, 'validation_error', ['account']],
  ])('%s names the rejected wire field', async (fixture, call, code, fields) => {
    const { resource } = setup([wireResponse(`payments/${fixture}.wire.json`)]);

    await expectApiError(call(resource), { code, fields });
  });

  it('names no field for field_required, which puts it only in the message', async () => {
    const { resource } = setup([wireResponse('payments/pay.fieldRequired.wire.json')]);

    await expectApiError(pay(resource), { code: 'field_required' });
  });
});

describe('payments.refund', () => {
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

  it('forwards sms unchanged', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/startPan.success.wire.json')]);

    await resource.startPanPayment({ ...startPanParams, sms: { hash: 'app-hash', templateId: 1 } });

    expect(fetchImpl.calls[0]?.body).toMatchObject({ sms: { hash: 'app-hash', templateId: 1 } });
  });

  it.each([
    ['cardNumber', { cardNumber: ' ' }, 'sdk_invalid_input', 'required'],
    ['cardExpiry', { cardExpiry: 9912 }, 'sdk_invalid_input', 'type'],
    ['account', { account: 'order-1' }, 'sdk_invalid_input', 'type'],
    ['amountTiyin', { amountTiyin: 120_050 }, 'sdk_invalid_amount', 'format'],
    ['sms.hash', { sms: { hash: 7 } }, 'sdk_invalid_input', 'type'],
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

    const apiError = await captureAsync(resource.startPanPayment(startPanParams));
    const inputError = await captureAsync(
      resource.startPanPayment({ ...startPanParams, cardExpiry: 'MM-YY-FROM-SECURE-INPUT' }),
    );

    expect(apiError).toMatchObject({ code: 'card_not_found' });
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

  it('forwards sms unchanged', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/confirmPan.success.wire.json')]);

    await resource.confirmPanPayment({ transactionId: PAN_TRANSACTION_ID, otp: OTP, sms: {} });

    expect(fetchImpl.calls[0]?.body).toEqual({
      transactionId: PAN_TRANSACTION_ID,
      otp: OTP,
      sms: {},
    });
  });

  it('reports how long a card blocked by wrong OTPs stays blocked', async () => {
    const { resource } = setup([wireResponse('payments/confirmPan.cardBlocked.wire.json')]);

    const error = await expectApiError(
      resource.confirmPanPayment({ transactionId: PAN_TRANSACTION_ID, otp: OTP }),
      { code: 'card_is_blocked', httpStatus: 400 },
    );

    expect(error.retryAfterSeconds).toBe(297);
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

describe('call options', () => {
  it('rejects a signal that is not an AbortSignal before any request', async () => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(
      resource.refund({ transactionId: TRANSACTION_ID }, { signal: 'stop' as never }),
      { field: 'signal', rule: 'type' },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('passes the caller signal to the request', async () => {
    const { resource, fetchImpl } = setup([wireResponse('payments/refund.success.wire.json')]);
    const controller = new AbortController();

    await resource.refund({ transactionId: TRANSACTION_ID }, { signal: controller.signal });
    controller.abort();

    expect(fetchImpl.calls[0]?.signal?.aborted).toBe(true);
  });
});
