import { describe, expect, it } from 'vitest';

import { PaylovClient } from '../../src/client.js';
import type { PaylovFakeMethod } from '../../src/core/fake.js';
import { PaylovOnboarding } from '../../src/onboarding/client.js';
import type { Card } from '../../src/cards/types.js';
import type { Transaction } from '../../src/transactions/types.js';
import { PaylovFakeGateway } from '../../src/testing/gateway.js';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-01-02T03:04:05Z');
const LATER = new Date('2026-01-03T23:59:59Z');
const PINFL = '88888888888888';
const PHONE = '+998123456789';
const OTP = 'OTP-FROM-SMS-ENTERED-BY-CARDHOLDER';
const PAN = 'PAN-FROM-SECURE-INPUT';
const ACCOUNT = { order_id: 'A-1024' };
const ITEM = {
  title: 'Consultation',
  priceTiyin: 25_000_000,
  count: 1,
  code: '10112001001000000',
  vatPercent: 12,
  packageCode: '1497773',
  pinfl: PINFL,
};
const CARD: Card = {
  cardId: id(1),
  userId: 'user-42',
  holderName: 'EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON',
  cardName: null,
  maskedCardNumber: '8600****1234',
  balanceTiyin: 1_000_000,
  bankId: '12',
  bankName: null,
  vendor: 'Uzcard',
  processing: 'Uzcard',
  isActive: true,
  processingStatus: 'Active',
  isSmsEnabled: true,
};
const TRANSACTION: Transaction = {
  transactionId: id(2),
  externalId: 'order-1',
  userId: 'user-42',
  cardId: id(1),
  maskedCardNumber: '8600****1234',
  amountTiyin: 2_500_000,
  status: 'paid',
  declineCode: null,
  paidOrCreatedAt: AT,
  cancelledAt: null,
  isHold: false,
  isSplit: false,
  isA2c: false,
  isCheckout: true,
  fiscalReceipts: [
    {
      receiptId: 7,
      receiptUrl: 'https://ofd.example/7',
      issuedAtRaw: '20260102030405',
      isRefund: false,
    },
  ],
};
const RECEIPT = {
  receiptId: 7,
  receiptUrl: 'https://ofd.example/7',
  terminalId: 'EXAMPLE-TERMINAL',
  fiscalSign: 'EXAMPLE-FISCAL-SIGN',
};

interface Setup {
  readonly fake: PaylovFakeGateway;
  readonly paylov: PaylovClient;
  readonly onboarding: PaylovOnboarding;
}

/**
 * Scripts `result`, runs `call` with `params` through the real SDK, and expects `result` back
 * and `params` recorded as the request the SDK sent.
 */
async function roundTrip<T, P>(
  method: PaylovFakeMethod<T, P>,
  result: T,
  params: NoInfer<P>,
  call: (params: P) => Promise<T>,
): Promise<void> {
  method.reply(result);
  await expect(call(params)).resolves.toEqual(result);
  expect(method.requests).toEqual([params]);
}

type Case = (setup: Setup) => Promise<void>;

/** One case per scripted method; the completeness test below keeps it exhaustive. */
const CASES: Readonly<Record<string, Case>> = {
  'gateway.getStatus': ({ fake, paylov }) =>
    roundTrip(fake.gateway.getStatus, undefined, undefined, () => paylov.gateway.getStatus()),
  'gateway.listBanks': ({ fake, paylov }) =>
    roundTrip(
      fake.gateway.listBanks,
      [{ bankId: '12', name: 'Bank', officialName: null }],
      undefined,
      () => paylov.gateway.listBanks(),
    ),
  'cards.createBindLink': ({ fake, paylov }) =>
    roundTrip(
      fake.cards.createBindLink,
      { token: 'EXAMPLE-BIND-TOKEN', bindUrl: 'https://bind.example/t', expiresAt: AT },
      { userId: 'user-42', returnUrl: 'https://shop.example/cards' },
      (params) => paylov.cards.createBindLink(params),
    ),
  'cards.getBindSession': ({ fake, paylov }) =>
    roundTrip(
      fake.cards.getBindSession,
      { isBound: true, status: 'confirmed', card: CARD },
      { token: 'EXAMPLE-BIND-TOKEN' },
      (params) => paylov.cards.getBindSession(params),
    ),
  'cards.startPanBinding': ({ fake, paylov }) =>
    roundTrip(
      fake.cards.startPanBinding,
      { cardId: id(1), otpSentPhone: '99890***4567' },
      {
        userId: 'user-42',
        cardNumber: PAN,
        cardExpiry: '9912',
        phoneNumber: PHONE,
        sms: { hash: 'app-hash', templateId: 1 },
      },
      (params) => paylov.cards.startPanBinding(params),
    ),
  'cards.confirmPanBinding': ({ fake, paylov }) =>
    roundTrip(
      fake.cards.confirmPanBinding,
      CARD,
      { cardId: id(1), otp: OTP, cardName: 'Salary', pinfl: PINFL },
      (params) => paylov.cards.confirmPanBinding(params),
    ),
  'cards.get': ({ fake, paylov }) =>
    roundTrip(
      fake.cards.get,
      { ...CARD, cardName: 'Salary', bankName: 'Bank' },
      { cardId: id(1) },
      (params) => paylov.cards.get(params),
    ),
  'cards.list': ({ fake, paylov }) =>
    roundTrip(fake.cards.list, [CARD], { userId: 'user-42' }, (params) =>
      paylov.cards.list(params),
    ),
  'cards.delete': ({ fake, paylov }) =>
    roundTrip(fake.cards.delete, undefined, { cardId: id(1) }, (params) =>
      paylov.cards.delete(params),
    ),
  'cards.checkPhone': ({ fake, paylov }) =>
    roundTrip(fake.cards.checkPhone, true, { cardId: id(1), phoneNumber: PHONE }, (params) =>
      paylov.cards.checkPhone(params),
    ),
  'payments.create': ({ fake, paylov }) =>
    roundTrip(
      fake.payments.create,
      { transactionId: id(2) },
      { amountTiyin: 2_500_000, account: ACCOUNT, userId: 'user-42' },
      (params) => paylov.payments.create(params),
    ),
  'payments.pay': ({ fake, paylov }) =>
    roundTrip(
      fake.payments.pay,
      { transactionId: id(2) },
      { transactionId: id(2), cardId: id(1), userId: 'user-42' },
      (params) => paylov.payments.pay(params),
    ),
  'payments.refund': ({ fake, paylov }) =>
    roundTrip(
      fake.payments.refund,
      { transactionId: id(2), refundedAt: AT },
      { transactionId: id(2) },
      (params) => paylov.payments.refund(params),
    ),
  'payments.startPanPayment': ({ fake, paylov }) =>
    roundTrip(
      fake.payments.startPanPayment,
      { transactionId: id(2), otpSentPhone: '99890***4567' },
      {
        cardNumber: PAN,
        cardExpiry: '9912',
        amountTiyin: 120_000,
        account: ACCOUNT,
        sms: { templateId: 1 },
      },
      (params) => paylov.payments.startPanPayment(params),
    ),
  'payments.confirmPanPayment': ({ fake, paylov }) =>
    roundTrip(
      fake.payments.confirmPanPayment,
      { transactionId: id(2) },
      { transactionId: id(2), otp: OTP, sms: { hash: 'app-hash' } },
      (params) => paylov.payments.confirmPanPayment(params),
    ),
  'transactions.get': ({ fake, paylov }) =>
    roundTrip(fake.transactions.get, TRANSACTION, { transactionId: id(2) }, (params) =>
      paylov.transactions.get(params),
    ),
  'transactions.list': ({ fake, paylov }) =>
    roundTrip(
      fake.transactions.list,
      {
        total: 1,
        transactions: [
          { ...TRANSACTION, status: 'refunded', cancelledAt: LATER, isCheckout: false },
        ],
      },
      { fromDate: '2026-01-01', toDate: '2026-01-31', page: 2 },
      (params) => paylov.transactions.list(params),
    ),
  'transactions.getRrn': ({ fake, paylov }) =>
    roundTrip(fake.transactions.getRrn, '600000000001', { transactionId: id(2) }, (params) =>
      paylov.transactions.getRrn(params),
    ),
  'holds.create': async ({ fake }) => {
    // The SDK adds the deadline from the client clock.
    const paylov = new PaylovClient({ ...fake.clientConfig, now: () => AT });
    const params = {
      userId: 'user-42',
      cardId: id(1),
      amountTiyin: 100_000,
      durationMinutes: 60,
      externalId: 'hold-1',
      account: ACCOUNT,
      serviceId: id(3),
    };
    fake.holds.create.reply({ transactionId: id(4) });
    await expect(paylov.holds.create(params)).resolves.toEqual({
      transactionId: id(4),
      durationMinutes: 60,
      clientCaptureDeadline: new Date(AT.getTime() + 60 * 60_000),
    });
    expect(fake.holds.create.requests).toEqual([params]);
  },
  'holds.capture': ({ fake, paylov }) =>
    roundTrip(
      fake.holds.capture,
      { transactionId: id(4), cardId: id(1), capturedAt: AT },
      { transactionId: id(4), amountTiyin: 100_000 },
      (params) => paylov.holds.capture(params),
    ),
  'holds.release': ({ fake, paylov }) =>
    roundTrip(fake.holds.release, { transactionId: id(4) }, { transactionId: id(4) }, (params) =>
      paylov.holds.release(params),
    ),
  'holds.get': ({ fake, paylov }) =>
    roundTrip(
      fake.holds.get,
      {
        transactionId: id(4),
        status: 'captured',
        amountTiyin: 100_000,
        capturedAt: AT,
        releasedAt: null,
        serviceId: id(3),
      },
      { transactionId: id(4) },
      (params) => paylov.holds.get(params),
    ),
  'splits.create': ({ fake, paylov }) =>
    roundTrip(
      fake.splits.create,
      { transactionId: id(2) },
      {
        transactionId: id(2),
        recipients: [
          {
            recipientId: 'platform',
            amountTiyin: 850_000,
            items: [{ ...ITEM, priceTiyin: 850_000, discountTiyin: 50_000 }],
          },
        ],
        resendOfd: true,
      },
      (params) => paylov.splits.create(params),
    ),
  'splits.get': ({ fake, paylov }) =>
    roundTrip(
      fake.splits.get,
      [
        {
          recipientId: 'platform',
          amountTiyin: 850_000,
          status: 'paid',
          createdAtRaw: '2026-01-02',
        },
      ],
      { transactionId: id(2) },
      (params) => paylov.splits.get(params),
    ),
  'subMerchants.create': ({ fake, paylov }) =>
    roundTrip(
      fake.subMerchants.create,
      { subMerchantId: '17', name: 'Shop' },
      {
        name: 'Shop',
        tin: '123456789',
        pinfl: PINFL,
        organization: {
          name: 'Shop LLC',
          directorPinfl: PINFL,
          accountNumber: '20208000000000000001',
          oked: '47190',
          directorFullName: 'EXAMPLE-DIRECTOR-NOT-A-REAL-PERSON',
          mfo: '00014',
        },
        externalId: 'merchant-1',
        isSelfEmployed: false,
        ofdVatPercent: 12,
        spic: '10112001001000000',
        spicPackageCode: '1497773',
      },
      (params) => paylov.subMerchants.create(params),
    ),
  'fiscalization.registerReceipt': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.registerReceipt,
      RECEIPT,
      { transactionId: id(2), items: [ITEM] },
      (params) => paylov.fiscalization.registerReceipt(params),
    ),
  'fiscalization.getReceipt': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.getReceipt,
      { ...RECEIPT, isRefund: true },
      { transactionId: id(2), isRefund: true },
      (params) => paylov.fiscalization.getReceipt(params),
    ),
  'fiscalization.attachReceipt': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.attachReceipt,
      undefined,
      {
        transactionId: id(2),
        terminalId: 'EXAMPLE-TERMINAL',
        issuedAtRaw: '20260102080405',
        fiscalSign: 'EXAMPLE-FISCAL-SIGN',
        receiptUrl: 'https://ofd.example/7',
        receiptId: 7,
      },
      (params) => paylov.fiscalization.attachReceipt(params),
    ),
  'fiscalization.refundReceipt': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.refundReceipt,
      { refund: { ...RECEIPT, receiptId: 8 }, sale: RECEIPT },
      { receiptId: 7 },
      (params) => paylov.fiscalization.refundReceipt(params),
    ),
  'fiscalization.checkActivityType': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.checkActivityType,
      { isConfirmed: false, activityNames: ['Consulting'] },
      { pinfl: PINFL, activityType: 'high_income' },
      (params) => paylov.fiscalization.checkActivityType(params),
    ),
  'onboarding.checkToken': ({ fake, onboarding }) =>
    roundTrip(fake.onboarding.checkToken, true, { token: 'EXAMPLE-ONBOARDING-TOKEN' }, (params) =>
      onboarding.checkToken(params),
    ),
  'onboarding.complete': ({ fake, onboarding }) =>
    roundTrip(
      fake.onboarding.complete,
      {
        consumerKey: 'EXAMPLE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL',
        consumerSecret: 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL',
        username: 'EXAMPLE-USERNAME-NOT-A-REAL-CREDENTIAL',
      },
      {
        token: 'EXAMPLE-ONBOARDING-TOKEN',
        username: 'EXAMPLE-USERNAME',
      },
      (params) => onboarding.complete({ ...params, password: 'EXAMPLE-PASSWORD' }),
    ),
};

/**
 * Other wire forms of a method: a miss, an empty answer, another variant of the record, or another
 * request shape.
 */
const MISSES: Readonly<Record<string, Case>> = {
  'transactions.list': ({ fake, paylov }) =>
    roundTrip(
      fake.transactions.list,
      {
        total: 1,
        transactions: [{ ...TRANSACTION, status: 'failed', declineCode: 'insufficient_funds' }],
      },
      {},
      () => paylov.transactions.list(),
    ),
  'holds.get': ({ fake, paylov }) =>
    roundTrip(fake.holds.get, null, { externalId: 'hold-1' }, (params) => paylov.holds.get(params)),
  'fiscalization.registerReceipt': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.registerReceipt,
      RECEIPT,
      {
        externalId: 'cash-1',
        phoneNumber: PHONE,
        items: [{ ...ITEM, pinfl: undefined, tin: '900000001' }],
      },
      (params) => paylov.fiscalization.registerReceipt(params),
    ),
  'subMerchants.create': ({ fake, paylov }) =>
    roundTrip(
      fake.subMerchants.create,
      { subMerchantId: '17', name: 'Shop' },
      { name: 'Shop', tin: '900000001' },
      (params) => paylov.subMerchants.create(params),
    ),
  'subMerchants.create with a pinfl alone': ({ fake, paylov }) =>
    roundTrip(
      fake.subMerchants.create,
      { subMerchantId: '18', name: 'Sole trader' },
      { name: 'Sole trader', pinfl: PINFL },
      (params) => paylov.subMerchants.create(params),
    ),
  'transactions.get': ({ fake, paylov }) =>
    roundTrip(fake.transactions.get, null, { transactionId: id(2) }, (params) =>
      paylov.transactions.get(params),
    ),
  'fiscalization.getReceipt': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.getReceipt,
      null,
      { externalId: 'order-1', isRefund: false },
      (params) => paylov.fiscalization.getReceipt(params),
    ),
  'fiscalization.getReceipt without isRefund': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.getReceipt,
      { ...RECEIPT, isRefund: false },
      { transactionId: id(2) },
      (params) => paylov.fiscalization.getReceipt(params),
    ),
  'onboarding.checkToken': ({ fake, onboarding }) =>
    roundTrip(fake.onboarding.checkToken, false, { token: 'EXAMPLE-ONBOARDING-TOKEN' }, (params) =>
      onboarding.checkToken(params),
    ),
  'cards.getBindSession': ({ fake, paylov }) =>
    roundTrip(
      fake.cards.getBindSession,
      { isBound: false, status: 'created', card: null },
      { token: 'EXAMPLE-BIND-TOKEN' },
      (params) => paylov.cards.getBindSession(params),
    ),
  'fiscalization.checkActivityType': ({ fake, paylov }) =>
    roundTrip(
      fake.fiscalization.checkActivityType,
      { isConfirmed: true, activityNames: [] },
      { pinfl: PINFL, activityType: 'self_employed' },
      (params) => paylov.fiscalization.checkActivityType(params),
    ),
};

function setup(): Setup {
  const fake = new PaylovFakeGateway();
  return {
    fake,
    paylov: new PaylovClient(fake.clientConfig),
    onboarding: new PaylovOnboarding(fake.onboardingConfig),
  };
}

/** `surface.method` for every script the fake exposes. */
function scriptedMethods(fake: PaylovFakeGateway): string[] {
  return Object.entries(fake).flatMap(([surface, scripts]: [string, unknown]) =>
    typeof scripts === 'object' &&
    scripts !== null &&
    !Array.isArray(scripts) &&
    !surface.endsWith('Config')
      ? Object.keys(scripts).map((method) => `${surface}.${method}`)
      : [],
  );
}

describe('PaylovFakeGateway replies', () => {
  it('covers every scripted method', () => {
    expect(Object.keys(CASES).toSorted()).toEqual(
      scriptedMethods(new PaylovFakeGateway()).toSorted(),
    );
  });

  it.each(Object.entries(CASES))('%s decodes back to the scripted result', async (method, run) => {
    const context = setup();
    await run(context);
    expect(context.fake.calls.at(-1)?.method).toBe(method);
    context.fake.assertDone();
  });

  it.each(Object.entries(MISSES))(
    '%s also reads back its other wire form',
    async (_method, run) => {
      const context = setup();
      await run(context);
      expect(() => {
        context.fake.assertDone();
      }).not.toThrow();
    },
  );
});
