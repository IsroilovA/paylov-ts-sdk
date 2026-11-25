import { describe, expect, it } from 'vitest';

import { PaylovClient, type PaylovClientConfig } from '../src/client.js';
import { PaylovConnectionError } from '../src/core/errors.js';
import { PaylovOnboarding } from '../src/onboarding/client.js';
import { PaylovFakeGateway } from '../src/testing/gateway.js';
import { captureAsync, expectInputError, expectNoSecretLeak } from './helpers/asserts.js';
import { createFakeFetch } from './helpers/fakeFetch.js';
import { BASE_URL } from './helpers/testHttp.js';

const CONSUMER_SECRET = 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL';
const PASSWORD = 'EXAMPLE-PASSWORD-NOT-A-REAL-CREDENTIAL';

const VALID: PaylovClientConfig = {
  baseUrl: BASE_URL,
  consumerKey: 'EXAMPLE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL',
  consumerSecret: CONSUMER_SECRET,
  username: 'EXAMPLE-USERNAME-NOT-A-REAL-CREDENTIAL',
  password: PASSWORD,
};

const CONFIG = 'sdk_config_error';
const TRANSACTION_ID = '00000000-0000-4000-8000-000000000001';
const CREDENTIALS = [PASSWORD, CONSUMER_SECRET];

describe('PaylovClient configuration', () => {
  it.each([undefined, null, [], 'config', 42, true])('rejects the config %j', async (config) => {
    await expectInputError(() => new PaylovClient(config as never), {
      code: CONFIG,
      field: undefined,
      rule: 'type',
    });
  });

  it.each(['baseUrl', 'consumerKey', 'consumerSecret', 'username', 'password'] as const)(
    'rejects a missing or blank %s without quoting its value',
    async (field) => {
      for (const [bad, rule] of [
        [undefined, 'required'],
        ['', 'required'],
        ['   ', 'required'],
        [42, 'type'],
        [{}, 'type'],
        [[], 'type'],
      ] as const) {
        const error = await expectInputError(() => new PaylovClient({ ...VALID, [field]: bad }), {
          code: CONFIG,
          field,
          rule,
        });
        expectNoSecretLeak(error, CREDENTIALS);
      }
    },
  );

  it.each([
    ['not an absolute URL', 'api.paylov.uz', 'baseUrl must be an absolute https URL'],
    ['another scheme', 'ftp://api.paylov.uz', 'baseUrl must be an absolute https URL'],
    ['cleartext http', 'http://dev.gw.paylov.uz', 'baseUrl must use https'],
    ['a /merchant path', `${BASE_URL}/merchant`, 'baseUrl must be an origin without a path'],
  ])('rejects a baseUrl with %s', async (_label, baseUrl, message) => {
    const error = await expectInputError(() => new PaylovClient({ ...VALID, baseUrl }), {
      code: CONFIG,
      field: 'baseUrl',
      rule: 'format',
    });
    expect(error.message).toBe(`PaylovClient config: ${message}`);
  });

  it.each([
    ['a negative count', -1, 'range'],
    ['more than five', 6, 'range'],
    ['a fraction', 1.5, 'type'],
    ['a string', '2', 'type'],
  ] as const)('rejects maxGetRetries as %s', async (_label, maxGetRetries, rule) => {
    await expectInputError(() => new PaylovClient({ ...VALID, maxGetRetries } as never), {
      code: CONFIG,
      field: 'maxGetRetries',
      rule,
    });
  });

  it('rejects a now that is not a function', async () => {
    await expectInputError(() => new PaylovClient({ ...VALID, now: new Date() } as never), {
      code: CONFIG,
      field: 'now',
      rule: 'type',
    });
  });

  it('rejects a clock that returns no valid Date at construction', async () => {
    await expectInputError(() => new PaylovClient({ ...VALID, now: Date.now } as never), {
      code: CONFIG,
      field: 'now',
      rule: 'type',
    });
  });

  it.each([
    [0, 1],
    [1, 2],
  ])(
    'passes maxGetRetries %i to the transport: %i GET attempts',
    async (maxGetRetries, attempts) => {
      const fake = new PaylovFakeGateway();
      fake.transactions.get.fail('server_error', { httpStatus: 503 }, { persist: true });
      const paylov = new PaylovClient({ ...fake.clientConfig, maxGetRetries });

      await captureAsync(paylov.transactions.get({ transactionId: TRANSACTION_ID }));

      expect(fake.transactions.get.requests).toHaveLength(attempts);
    },
  );

  it('accepts the largest maxGetRetries', () => {
    expect(() => new PaylovClient({ ...VALID, maxGetRetries: 5 })).not.toThrow();
  });

  it('rejects credentials, queries and fragments on baseUrl without quoting them', async () => {
    const secret = 'EXAMPLE-BASE-URL-SECRET';
    for (const baseUrl of [
      `https://merchant:${secret}@api.paylov.test`,
      `https://api.paylov.test/?token=${secret}`,
      `https://api.paylov.test/#${secret}`,
      'https://api.paylov.test?',
    ]) {
      const error = await expectInputError(() => new PaylovClient({ ...VALID, baseUrl }), {
        code: CONFIG,
        field: 'baseUrl',
        rule: 'format',
      });
      expectNoSecretLeak(error, [secret, baseUrl, ...CREDENTIALS]);
    }
  });

  it('accepts a padded origin, a trailing slash and an explicit port', () => {
    for (const baseUrl of [`  ${BASE_URL}  `, `${BASE_URL}/`, 'https://api.paylov.test:8443']) {
      expect(new PaylovClient({ ...VALID, baseUrl })).toBeInstanceOf(PaylovClient);
    }
  });

  it('rejects a non-positive, fractional or oversized timeoutMs', async () => {
    for (const [timeoutMs, rule] of [
      [0, 'range'],
      [-1, 'range'],
      [1.5, 'type'],
      [2_147_483_648, 'range'],
      [Number.MAX_SAFE_INTEGER, 'range'],
    ] as const) {
      await expectInputError(() => new PaylovClient({ ...VALID, timeoutMs }), {
        code: CONFIG,
        field: 'timeoutMs',
        rule,
      });
    }
  });

  it('validates the fetch and logger shapes', async () => {
    for (const [key, value, field] of [
      ['fetch', {}, 'fetch'],
      ['fetch', 'fetch', 'fetch'],
      ['logger', [], 'logger'],
      ['logger', 'logger', 'logger'],
      ['logger', { onRequest: true }, 'logger.onRequest'],
      ['logger', { onResponse: true }, 'logger.onResponse'],
    ] as const) {
      const error = await expectInputError(() => new PaylovClient({ ...VALID, [key]: value }), {
        code: CONFIG,
        field,
        rule: 'type',
      });
      expect(error.message).toContain(field);
    }
  });

  it('does no I/O on construction', () => {
    const fetchImpl = createFakeFetch([]);
    void new PaylovClient({ ...VALID, fetch: fetchImpl });
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('PaylovClient.close', () => {
  it('needs no I/O before any token was issued, and can be repeated', async () => {
    const fetchImpl = createFakeFetch([]);
    const client = new PaylovClient({ ...VALID, fetch: fetchImpl });
    await client.close();
    await client.close({});
    await client.close({ signal: AbortSignal.timeout(1_000) });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('rejects options that carry anything but an AbortSignal', async () => {
    const client = new PaylovClient(VALID);
    await expectInputError(client.close({ signal: 'soon' as never }), {
      field: 'signal',
      rule: 'type',
    });
  });
});

const ID = '5eed0000-0000-4000-8000-000000000001';
const PINFL = '88888888888888';
const RECEIPT_ITEM = {
  title: 'Consultation',
  priceTiyin: 100_000,
  count: 1,
  code: '10112001001000000',
  vatPercent: 12,
  packageCode: '1497773',
  tin: '123456789',
};

type ClientCall = (client: PaylovClient, signal: AbortSignal) => Promise<unknown>;
type OnboardingCall = (onboarding: PaylovOnboarding, signal: AbortSignal) => Promise<unknown>;

// One row per public method with valid params, so only the signal can refuse the call.
const CLIENT_CALLS: Readonly<Record<string, ClientCall>> = {
  'gateway.getStatus': (c, signal) => c.gateway.getStatus({ signal }),
  'gateway.listBanks': (c, signal) => c.gateway.listBanks({ signal }),
  'cards.startPanBinding': (c, signal) =>
    c.cards.startPanBinding(
      { userId: 'user-1', cardNumber: 'PAN-FROM-SECURE-INPUT', cardExpiry: '9912' },
      { signal },
    ),
  'cards.confirmPanBinding': (c, signal) =>
    c.cards.confirmPanBinding({ cardId: ID, otp: 'OTP-FROM-SMS-EXAMPLE' }, { signal }),
  'cards.get': (c, signal) => c.cards.get({ cardId: ID }, { signal }),
  'cards.list': (c, signal) => c.cards.list({ userId: 'user-1' }, { signal }),
  'cards.delete': (c, signal) => c.cards.delete({ cardId: ID }, { signal }),
  'cards.checkPhone': (c, signal) =>
    c.cards.checkPhone({ cardId: ID, phoneNumber: '+998900000000' }, { signal }),
  'payments.create': (c, signal) => c.payments.create({ amountTiyin: 100 }, { signal }),
  'payments.pay': (c, signal) =>
    c.payments.pay({ transactionId: ID, cardId: ID, userId: 'user-1' }, { signal }),
  'payments.refund': (c, signal) => c.payments.refund({ transactionId: ID }, { signal }),
  'payments.startPanPayment': (c, signal) =>
    c.payments.startPanPayment(
      { cardNumber: 'PAN-FROM-SECURE-INPUT', cardExpiry: '9912', amountTiyin: 100 },
      { signal },
    ),
  'payments.confirmPanPayment': (c, signal) =>
    c.payments.confirmPanPayment({ transactionId: ID, otp: 'OTP-FROM-SMS-EXAMPLE' }, { signal }),
  'transactions.get': (c, signal) => c.transactions.get({ transactionId: ID }, { signal }),
  'transactions.list': (c, signal) => c.transactions.list({}, { signal }),
  'transactions.iterate': (c, signal) =>
    c.transactions.iterate({}, { signal })[Symbol.asyncIterator]().next(),
  'transactions.getRrn': (c, signal) => c.transactions.getRrn({ transactionId: ID }, { signal }),
  'holds.create': (c, signal) =>
    c.holds.create(
      {
        userId: 'user-1',
        cardId: ID,
        amountTiyin: 100,
        durationMinutes: 30,
        externalId: 'order-1',
      },
      { signal },
    ),
  'holds.capture': (c, signal) =>
    c.holds.capture({ transactionId: ID, amountTiyin: 100 }, { signal }),
  'holds.release': (c, signal) => c.holds.release({ transactionId: ID }, { signal }),
  'holds.get': (c, signal) => c.holds.get({ transactionId: ID }, { signal }),
  'splits.create': (c, signal) =>
    c.splits.create(
      { transactionId: ID, recipients: [{ recipientId: 'platform', amountTiyin: 100 }] },
      { signal },
    ),
  'splits.resendReceipt': (c, signal) =>
    c.splits.resendReceipt(
      {
        transactionId: ID,
        recipients: [{ recipientId: 'platform', amountTiyin: 100, items: [RECEIPT_ITEM] }],
      },
      { signal },
    ),
  'splits.get': (c, signal) => c.splits.get({ transactionId: ID }, { signal }),
  'fiscalization.registerReceipt': (c, signal) =>
    c.fiscalization.registerReceipt({ transactionId: ID, items: [RECEIPT_ITEM] }, { signal }),
  'fiscalization.getReceipt': (c, signal) =>
    c.fiscalization.getReceipt({ transactionId: ID }, { signal }),
  'fiscalization.refundReceipt': (c, signal) =>
    c.fiscalization.refundReceipt({ receiptId: 1 }, { signal }),
  'fiscalization.checkActivityType': (c, signal) =>
    c.fiscalization.checkActivityType({ pinfl: PINFL, activityType: 'self_employed' }, { signal }),
  'subMerchants.create': (c, signal) =>
    c.subMerchants.create({ name: 'Shop', tin: '900000001' }, { signal }),
};

const ONBOARDING_CALLS: Readonly<Record<string, OnboardingCall>> = {
  checkToken: (o, signal) =>
    o.checkToken({ token: 'EXAMPLE-ONBOARDING-TOKEN-NOT-A-REAL-TOKEN' }, { signal }),
  complete: (o, signal) =>
    o.complete(
      { token: 'EXAMPLE-ONBOARDING-TOKEN-NOT-A-REAL-TOKEN', username: 'user', password: PASSWORD },
      { signal },
    ),
};

function clientMethods(client: PaylovClient): string[] {
  return Object.entries(client).flatMap(([namespace, resource]: [string, unknown]) =>
    typeof resource === 'object' && resource !== null
      ? Object.keys(resource).map((name) => `${namespace}.${name}`)
      : [],
  );
}

describe('an already-aborted caller signal', () => {
  it('has a row for every public method', () => {
    expect(clientMethods(new PaylovClient(VALID)).toSorted()).toEqual(
      Object.keys(CLIENT_CALLS).toSorted(),
    );
    const onboardingMethods = Object.getOwnPropertyNames(PaylovOnboarding.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(onboardingMethods.toSorted()).toEqual(Object.keys(ONBOARDING_CALLS).toSorted());
  });

  it.each(Object.entries(CLIENT_CALLS))(
    'ends %s with sdk_aborted before any I/O',
    async (_, call) => {
      const fetchImpl = createFakeFetch([]);
      const client = new PaylovClient({ ...VALID, fetch: fetchImpl });

      const error = await captureAsync(call(client, AbortSignal.abort()));

      expect(error).toBeInstanceOf(PaylovConnectionError);
      expect(error).toMatchObject({ code: 'sdk_aborted', isSent: false });
      expect(fetchImpl.calls).toHaveLength(0);
    },
  );

  it.each(Object.entries(ONBOARDING_CALLS))(
    'ends onboarding.%s with sdk_aborted before any I/O',
    async (_, call) => {
      const fetchImpl = createFakeFetch([]);
      const onboarding = new PaylovOnboarding({ baseUrl: BASE_URL, fetch: fetchImpl });

      const error = await captureAsync(call(onboarding, AbortSignal.abort()));

      expect(error).toBeInstanceOf(PaylovConnectionError);
      expect(error).toMatchObject({ code: 'sdk_aborted', isSent: false });
      expect(fetchImpl.calls).toHaveLength(0);
    },
  );
});
