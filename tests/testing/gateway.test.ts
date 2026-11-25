import { describe, expect, it, vi } from 'vitest';

import { PaylovClient } from '../../src/client.js';
import { isPaylovOutcomeUnknown } from '../../src/core/errors.js';
import { PaylovFakeGateway } from '../../src/testing/gateway.js';
import { capture, captureAsync, expectApiError } from '../helpers/asserts.js';
import { recordingLogger } from '../helpers/testHttp.js';

const TRANSACTION_ID = '00000000-0000-4000-8000-000000000001';
const CARD_ID = '00000000-0000-4000-8000-000000000002';
const SERVICE_ID = '00000000-0000-4000-8000-000000000003';
const PAY = { transactionId: TRANSACTION_ID, cardId: CARD_ID, userId: 'user-42' };
const HOLD = {
  transactionId: TRANSACTION_ID,
  status: 'held',
  amountTiyin: 100_000,
  capturedAt: null,
  releasedAt: null,
  serviceId: SERVICE_ID,
};

function setup(timeoutMs?: number) {
  const fake = new PaylovFakeGateway();
  const { logger, responses } = recordingLogger();
  const config = {
    ...fake.clientConfig,
    logger,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  return { fake, paylov: new PaylovClient(config), responses };
}

/** What `assertDone()` reports, or `undefined` when it passes. */
function problemsOf(fake: PaylovFakeGateway): string | undefined {
  try {
    fake.assertDone();
    return undefined;
  } catch (error) {
    return String(error);
  }
}

describe('PaylovFakeGateway', () => {
  it('answers the token and revoke requests itself', async () => {
    const { fake, paylov, responses } = setup();
    fake.payments.pay.reply({ transactionId: TRANSACTION_ID });

    await paylov.payments.pay(PAY);
    await paylov.close();

    expect(responses.map(({ endpoint, httpStatus }) => [endpoint, httpStatus])).toEqual([
      ['POST /merchant/oauth2/token/', 200],
      ['POST /merchant/receipts/pay/', 200],
      ['POST /merchant/oauth2/revoke/', 200],
    ]);
    expect(fake.token.requests).toEqual(['password']);
    expect(fake.payments.pay.requests).toEqual([PAY]);
    fake.assertDone();
  });

  it('names a request by its route template, never by its path values', async () => {
    const { fake, paylov } = setup();
    const canaryId = 'CANARY-CARD-ID-NOT-A-REAL-ID';
    await expectApiError(paylov.cards.get({ cardId: canaryId }), {
      code: 'fake_unscripted',
      httpStatus: 501,
    });
    const unrouted = await fake.fetch(`https://gateway.example/merchant/unknown/${canaryId}/`, {
      method: 'GET',
    });
    expect(unrouted.status).toBe(501);
    expect(await unrouted.text()).not.toContain(canaryId);

    const problems = problemsOf(fake);
    expect(problems).toContain('unscripted request GET /merchant/userCard/getCard/{cardId}/');
    expect(problems).toContain('unscripted request GET (unknown route)');
    expect(problems).not.toContain(canaryId);
  });

  it('serves each answer to its own method when methods share an endpoint', async () => {
    const { fake, paylov } = setup();
    fake.transactions.list.fail('field_not_valid', { fields: ['beginDate'] });
    fake.transactions.get.fail('transaction_not_found');

    await expectApiError(paylov.transactions.get({ transactionId: TRANSACTION_ID }), {
      code: 'transaction_not_found',
      httpStatus: 200,
    });
    await expectApiError(paylov.transactions.list({ fromDate: '2026-11-01' }), {
      code: 'field_not_valid',
      fields: ['beginDate'],
    });
    expect(fake.transactions.get.requests).toEqual([{ transactionId: TRANSACTION_ID }]);
    expect(fake.transactions.list.requests).toEqual([{ fromDate: '2026-11-01' }]);
    fake.assertDone();
  });

  it('skips an earlier answer for the other method on a shared endpoint', async () => {
    const { fake, paylov } = setup();
    fake.transactions.get.fail('server_error');
    fake.transactions.list.fail('field_not_valid', { fields: ['beginDate'] });

    await expectApiError(paylov.transactions.list({ page: 2 }), {
      code: 'field_not_valid',
      fields: ['beginDate'],
    });
    expect(fake.transactions.get.requests).toEqual([]);
    await expectApiError(paylov.transactions.get({ transactionId: TRANSACTION_ID }), {
      code: 'server_error',
    });
    fake.assertDone();
  });

  it('leaves a request without its own answer unscripted, even beside a sibling answer', async () => {
    const { fake, paylov } = setup();
    fake.transactions.list.fail('server_error');

    await expectApiError(paylov.transactions.get({ transactionId: TRANSACTION_ID }), {
      code: 'fake_unscripted',
      httpStatus: 501,
    });
    expect(
      capture(() => {
        fake.assertDone();
      }),
    ).toMatchObject({
      message:
        'PaylovFakeGateway: unscripted request GET /merchant/getTransactions/; unserved transactions.list answer',
    });
  });

  it('fails an unscripted request recognizably and reports it', async () => {
    const { fake, paylov } = setup();
    await expectApiError(paylov.payments.pay(PAY), { code: 'fake_unscripted', httpStatus: 501 });
    fake.holds.get.reply(HOLD);

    expect(
      capture(() => {
        fake.assertDone();
      }),
    ).toMatchObject({
      message:
        'PaylovFakeGateway: unscripted request POST /merchant/receipts/pay/; unserved holds.get answer',
    });
  });

  it('answers a request its method cannot read back without a network failure', async () => {
    const fake = new PaylovFakeGateway();
    const paylov = new PaylovClient({
      ...fake.clientConfig,
      fetch: (input, init) => fake.fetch(input.split('?')[0] ?? input, init),
    });
    fake.holds.get.reply(HOLD);

    await expectApiError(paylov.holds.get({ transactionId: TRANSACTION_ID }), {
      code: 'fake_unreadable_request',
      httpStatus: 501,
    });
    expect(fake.holds.get.requests).toEqual([]);
    expect(
      capture(() => {
        fake.assertDone();
      }),
    ).toMatchObject({
      message:
        'PaylovFakeGateway: unreadable request GET /merchant/payment/hold/status/ (the holds.get request decoder threw); unserved holds.get answer',
    });
  });

  describe('fail', () => {
    it('answers a transaction miss as the gateway does: an empty list at HTTP 200', async () => {
      const { fake, paylov, responses } = setup();
      fake.transactions.get.fail('transaction_not_found');

      const miss = await expectApiError(
        paylov.transactions.get({ transactionId: TRANSACTION_ID }),
        {
          code: 'transaction_not_found',
          httpStatus: 200,
        },
      );
      expect(isPaylovOutcomeUnknown(miss)).toBe(false);
      expect(responses.at(-1)).toMatchObject({
        endpoint: 'GET /merchant/getTransactions/',
        httpStatus: 200,
      });
      expect(responses.at(-1)?.errorCode).toBeUndefined();
      expect(
        capture(() => {
          fake.transactions.get.fail('transaction_not_found', { httpStatus: 404 });
        }),
      ).toBeInstanceOf(TypeError);
      fake.assertDone();
    });

    it('reports the requested fields and retry delays', async () => {
      const { fake, paylov } = setup();
      const validationFields = ['account.order_id', 'account.phone', 'amount'];
      fake.payments.create.fail('validation_error', { fields: validationFields });
      fake.payments.create.fail('field_not_valid', { fields: ['amount'] });
      fake.payments.pay.fail('field_required', { fields: ['cardId'] });
      fake.payments.pay.fail('rate_limit_exceeded', { httpStatus: 429, retryAfterSeconds: 42 });
      fake.payments.confirmPanPayment.fail('card_is_blocked', { retryAfterSeconds: 298 });
      const create = () => paylov.payments.create({ amountTiyin: 100_000, account: {} });

      await expectApiError(create(), { code: 'validation_error', fields: validationFields });
      await expectApiError(create(), { code: 'field_not_valid', fields: ['amount'] });
      await expectApiError(paylov.payments.pay(PAY), {
        code: 'field_required',
        fields: ['cardId'],
      });
      const limited = await expectApiError(paylov.payments.pay(PAY), {
        code: 'rate_limit_exceeded',
        httpStatus: 429,
      });
      expect(limited.retryAfterSeconds).toBe(42);
      const confirm = { transactionId: TRANSACTION_ID, otp: 'OTP-ENTERED-BY-CARDHOLDER' };
      const blocked = await expectApiError(paylov.payments.confirmPanPayment(confirm), {
        code: 'card_is_blocked',
      });
      expect(blocked.retryAfterSeconds).toBe(298);
    });

    it.each([
      ['an SDK code', 'sdk_timeout', {}],
      ['a non-identifier code', 'Insufficient funds', {}],
      ['a success status', 'insufficient_funds', { httpStatus: 200 }],
      ['fields the code never reports', 'insufficient_funds', { fields: ['amount'] }],
      ['a second single field', 'field_not_valid', { fields: ['amount', 'account'] }],
      ['an unreportable retry delay', 'rate_limit_exceeded', { retryAfterSeconds: 0.5 }],
      ['a retry delay the code never reports', 'insufficient_funds', { retryAfterSeconds: 10 }],
    ])('rejects %s at scripting time', (_case, code, failure) => {
      const { fake } = setup();
      expect(
        capture(() => {
          fake.payments.pay.fail(code, failure);
        }),
      ).toBeInstanceOf(TypeError);
      fake.assertDone();
    });
  });

  describe('token failures', () => {
    it.each(['invalid_grant', 'card_is_blocked'] as const)(
      'scripts a 429 %s with its Retry-After delay, which the client cools down for',
      async (code) => {
        const { fake, paylov } = setup();
        fake.token.fail(code, { httpStatus: 429, retryAfterSeconds: 48 });

        const error = await expectApiError(paylov.payments.pay(PAY), { code, httpStatus: 429 });
        expect(error).toMatchObject({
          endpoint: 'POST /merchant/oauth2/token/',
          retryAfterSeconds: 48,
        });
        await expect(paylov.payments.pay(PAY)).rejects.toMatchObject({ code, httpStatus: 429 });
        expect(fake.token.requests).toEqual(['password']);
        expect(fake.payments.pay.requests).toEqual([]);
      },
    );

    it('rejects a delay the gateway cannot report outside a 429', () => {
      const { fake } = setup();
      expect(
        capture(() => {
          fake.token.fail('invalid_grant', { retryAfterSeconds: 48 });
        }),
      ).toBeInstanceOf(TypeError);
    });
  });

  describe('reply', () => {
    it('re-authenticates after a gateway token rejection and replays once', async () => {
      const { fake, paylov } = setup();
      fake.payments.pay.fail('permission_denied', { httpStatus: 401 });
      fake.payments.pay.reply({ transactionId: TRANSACTION_ID });

      await expect(paylov.payments.pay(PAY)).resolves.toEqual({ transactionId: TRANSACTION_ID });
      expect(fake.token.requests).toEqual(['password', 'refresh_token']);
      expect(fake.payments.pay.requests).toEqual([PAY, PAY]);
    });

    it.each([
      ['a fractional SUM amount', { ...HOLD, amountTiyin: 150 }],
      ['a sub-second time', { ...HOLD, capturedAt: new Date(1_767_225_600_500) }],
      ['an invalid time', { ...HOLD, releasedAt: new Date(Number.NaN) }],
      ['a wire status spelling the SDK renames', { ...HOLD, status: 'paid' }],
    ])('rejects %s the wire cannot carry', (_case, hold) => {
      const { fake } = setup();
      expect(
        capture(() => {
          fake.holds.get.reply(hold);
        }),
      ).toBeInstanceOf(TypeError);
    });

    it('passes a status outside the SDK vocabulary through', async () => {
      const { fake, paylov } = setup();
      const hold = { ...HOLD, status: 'frozen' };
      fake.holds.get.reply(hold);

      await expect(paylov.holds.get({ transactionId: TRANSACTION_ID })).resolves.toEqual(hold);
    });
  });

  describe('persistent answers', () => {
    it('serve every retry of a GET', async () => {
      vi.useFakeTimers();
      try {
        const { fake, paylov } = setup();
        fake.holds.get.fail('server_error', { httpStatus: 500 }, { persist: true });

        const read = captureAsync(paylov.holds.get({ transactionId: TRANSACTION_ID }));
        await vi.runAllTimersAsync();
        expect(await read).toMatchObject({ code: 'server_error', httpStatus: 500 });
        const lookup = { transactionId: TRANSACTION_ID };
        expect(fake.holds.get.requests).toEqual([lookup, lookup, lookup]);
        fake.assertDone();
      } finally {
        vi.useRealTimers();
      }
    });

    it('yield to one-time answers of the same method', async () => {
      const { fake, paylov } = setup();
      const released = {
        ...HOLD,
        status: 'released',
        releasedAt: new Date('2026-11-12T16:00:00Z'),
      };
      fake.holds.get.reply(released, { persist: true });
      fake.holds.get.reply(HOLD);

      await expect(paylov.holds.get({ transactionId: TRANSACTION_ID })).resolves.toEqual(HOLD);
      await expect(paylov.holds.get({ transactionId: TRANSACTION_ID })).resolves.toEqual(released);
      await expect(paylov.holds.get({ transactionId: TRANSACTION_ID })).resolves.toEqual(released);
      fake.assertDone();
    });

    it('are reported only when never served', () => {
      const { fake } = setup();
      fake.payments.pay.disconnect({ persist: true });

      expect(
        capture(() => {
          fake.assertDone();
        }),
      ).toMatchObject({ message: 'PaylovFakeGateway: unserved persistent payments.pay answer' });
    });
  });

  it('flags an unscripted request after a retryable GET answer as a likely retry', async () => {
    vi.useFakeTimers();
    try {
      const { fake, paylov } = setup();
      fake.holds.get.fail('server_error', { httpStatus: 503 });

      const read = captureAsync(paylov.holds.get({ transactionId: TRANSACTION_ID }));
      await vi.runAllTimersAsync();
      expect(await read).toMatchObject({ code: 'fake_unscripted' });
      const problem = capture(() => {
        fake.assertDone();
      });
      expect(problem).toBeInstanceOf(Error);
      expect(String(problem)).toContain(
        'unscripted request GET /merchant/payment/hold/status/ (likely a retry: the SDK retries',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  describe('connection failures', () => {
    it('disconnects without a retry on a POST and retries a GET', async () => {
      const { fake, paylov } = setup();
      fake.payments.pay.disconnect();
      fake.holds.get.disconnect();
      fake.holds.get.reply(HOLD);

      expect(await captureAsync(paylov.payments.pay(PAY))).toMatchObject({
        kind: 'connection',
        code: 'sdk_network_error',
      });
      await expect(paylov.holds.get({ transactionId: TRANSACTION_ID })).resolves.toEqual(HOLD);
      fake.assertDone();
    });

    it('hangs until the attempt times out', async () => {
      const { fake, paylov } = setup(20);
      fake.payments.pay.hang();

      expect(await captureAsync(paylov.payments.pay(PAY))).toMatchObject({ code: 'sdk_timeout' });
    });

    it('hangs until the caller aborts', async () => {
      const { fake, paylov } = setup();
      fake.payments.pay.hang();
      const controller = new AbortController();

      const pending = captureAsync(paylov.payments.pay(PAY, { signal: controller.signal }));
      await vi.waitFor(
        () => {
          expect(fake.payments.pay.requests).toHaveLength(1);
        },
        { interval: 1 },
      );
      controller.abort();
      expect(await pending).toMatchObject({ code: 'sdk_aborted' });
    });
  });
});
