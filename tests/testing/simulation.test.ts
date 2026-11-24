import { describe, expect, it } from 'vitest';

import type { Card } from '../../src/cards/types.js';
import { PaylovClient } from '../../src/client.js';
import { isPaylovOutcomeUnknown } from '../../src/core/errors.js';
import { readHoldState } from '../../src/holds/state.js';
import { PaylovFakeGateway } from '../../src/testing/gateway.js';
import { readRefundState } from '../../src/transactions/state.js';
import { captureAsync, expectApiError } from '../helpers/asserts.js';

// Every simulated transition comes from docs/paylov/payments.md, holds.md and transactions.md;
// the capture ids are cited in src/testing/simulation.ts.
const START = new Date('2026-11-12T10:00:00Z');
const CARD: Card = {
  cardId: '00000000-0000-4000-8000-0000000000c1',
  userId: 'user-42',
  holderName: 'EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON',
  cardName: null,
  maskedCardNumber: '860000******0000',
  balanceTiyin: 10_000_000,
  bankId: '12',
  bankName: null,
  vendor: 'Uzcard',
  processing: 'Uzcard',
  isActive: true,
  processingStatus: 'active',
  isSmsEnabled: true,
};
const INACTIVE_CARD: Card = {
  ...CARD,
  cardId: '00000000-0000-4000-8000-0000000000c2',
  isActive: false,
  processingStatus: 'blocked',
};
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff';
const SERVICE_ID = '00000000-0000-4000-8000-0000000000e1';
const PAY = { cardId: CARD.cardId, userId: CARD.userId };
const HOLD = {
  userId: CARD.userId,
  cardId: CARD.cardId,
  amountTiyin: 100_000,
  durationMinutes: 30,
  externalId: 'booking-1',
};

type Simulated = ReturnType<typeof simulated>;

function simulated() {
  let now = START;
  const fake = new PaylovFakeGateway({ simulate: true, now: () => now });
  fake.addCard(CARD);
  const paylov = new PaylovClient(fake.clientConfig);
  const advance = (minutes: number): void => {
    now = new Date(now.getTime() + minutes * 60_000);
  };
  return { fake, paylov, advance, now: () => now };
}

describe('the simulated gateway: sales', () => {
  it('runs create, pay, get, refund, get without scripting', async () => {
    const { fake, paylov, advance } = simulated();

    const { transactionId } = await paylov.payments.create({ amountTiyin: 250_000 });
    expect(await paylov.transactions.get({ transactionId })).toMatchObject({
      status: 'created',
      cardId: null,
      userId: null,
    });

    advance(1);
    await paylov.payments.pay({ transactionId, ...PAY });
    const paid = await paylov.transactions.get({ transactionId });
    expect(paid).toMatchObject({
      status: 'paid',
      cardId: CARD.cardId,
      userId: CARD.userId,
      maskedCardNumber: CARD.maskedCardNumber,
      amountTiyin: 250_000,
      paidOrCreatedAt: new Date('2026-11-12T10:01:00Z'),
    });
    expect(readRefundState({ transaction: paid })).toEqual({ kind: 'not_refunded' });

    advance(1);
    const refunded = await paylov.payments.refund({ transactionId });
    expect(refunded).toEqual({ transactionId, refundedAt: new Date('2026-11-12T10:02:00Z') });
    const read = await paylov.transactions.get({ transactionId });
    expect(read).toMatchObject({ status: 'refunded', paidOrCreatedAt: paid?.paidOrCreatedAt });
    expect(readRefundState({ transaction: read })).toEqual({
      kind: 'refunded',
      refundedAt: refunded.refundedAt,
    });

    expect(fake.payments.pay.requests).toEqual([{ transactionId, ...PAY }]);
    fake.assertDone();
  });

  it('answers a repeated pay and refund with the gateway codes', async () => {
    const { fake, paylov } = simulated();
    const { transactionId } = await paylov.payments.create({ amountTiyin: 100_000 });

    await expectApiError(paylov.payments.refund({ transactionId }), {
      code: 'transaction_not_available_for_cancel',
    });
    await paylov.payments.pay({ transactionId, ...PAY });
    await expectApiError(paylov.payments.pay({ transactionId, ...PAY }), {
      code: 'transaction_already_payed',
    });
    await paylov.payments.refund({ transactionId });
    await expectApiError(paylov.payments.refund({ transactionId }), {
      code: 'transaction_not_available_for_cancel',
    });
    await expectApiError(paylov.payments.pay({ transactionId, ...PAY }), {
      code: 'transaction_not_available_for_payment',
    });
    fake.assertDone();
  });

  it('checks the card: unknown, another user’s, and deleted', async () => {
    const { fake, paylov } = simulated();
    const { transactionId } = await paylov.payments.create({ amountTiyin: 100_000 });

    await expectApiError(
      paylov.payments.pay({ transactionId, cardId: CARD.cardId, userId: 'user-7' }),
      {
        code: 'card_is_not_for_this_check',
      },
    );
    expect(await paylov.cards.list({ userId: CARD.userId })).toEqual([CARD]);
    await paylov.cards.delete({ cardId: CARD.cardId });
    await expectApiError(paylov.cards.delete({ cardId: CARD.cardId }), {
      code: 'card_not_found',
      httpStatus: 404,
    });
    await expectApiError(paylov.payments.pay({ transactionId, ...PAY }), {
      code: 'card_not_found',
    });
    expect(await paylov.transactions.get({ transactionId })).toMatchObject({ status: 'created' });
    fake.assertDone();
  });

  it('leaves card reads after a delete unsimulated: the gateway caches them for a while', async () => {
    const { fake, paylov } = simulated();
    await paylov.cards.delete({ cardId: CARD.cardId });

    await expectApiError(paylov.cards.get({ cardId: CARD.cardId }), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    expect(() => {
      fake.assertDone();
    }).toThrow('unsimulated cards.get: cards.get of a deleted card');
  });
});

describe('the simulated gateway: holds', () => {
  it('runs hold, partial capture, get; the capture ends the hold', async () => {
    const { fake, paylov, advance } = simulated();

    const created = await paylov.holds.create(HOLD);
    expect(created.clientCaptureDeadline).toEqual(new Date('2026-11-12T10:30:00Z'));
    expect(await paylov.transactions.get(created)).toMatchObject({
      status: 'held',
      isHold: true,
      externalId: 'booking-1',
    });

    advance(5);
    const captured = await paylov.holds.capture({ ...created, amountTiyin: 40_000 });
    expect(captured).toEqual({
      transactionId: created.transactionId,
      cardId: CARD.cardId,
      capturedAt: new Date('2026-11-12T10:05:00Z'),
    });
    const hold = await paylov.holds.get({ externalId: 'booking-1' });
    expect(
      readHoldState({
        hold,
        clientCaptureDeadline: created.clientCaptureDeadline,
        now: new Date('2026-11-12T10:05:00Z'),
      }),
    ).toEqual({
      kind: 'captured',
      amountTiyin: 40_000,
      capturedAt: captured.capturedAt,
    });
    expect(await paylov.transactions.get(created)).toMatchObject({
      status: 'paid',
      amountTiyin: 40_000,
      paidOrCreatedAt: captured.capturedAt,
    });

    await expectApiError(paylov.holds.capture({ ...created, amountTiyin: 60_000 }), {
      code: 'transaction_not_available_for_payment',
    });
    await expectApiError(paylov.holds.release(created), { code: 'hold_not_found' });
    fake.assertDone();
  });

  it('refuses a capture above the held amount and keeps the hold open', async () => {
    const { fake, paylov } = simulated();
    const created = await paylov.holds.create(HOLD);

    await expectApiError(paylov.holds.capture({ ...created, amountTiyin: 100_100 }), {
      code: 'invalid_amount',
    });
    expect(await paylov.holds.get(created)).toMatchObject({ status: 'held', amountTiyin: 100_000 });
    fake.assertDone();
  });

  it('keeps an expired hold reading held, until a capture fails with hold_time_expired', async () => {
    const { fake, paylov, advance, now } = simulated();
    const created = await paylov.holds.create({ ...HOLD, durationMinutes: 1 });

    advance(46);
    const expired = await paylov.holds.get(created);
    expect(expired).toMatchObject({ status: 'held', releasedAt: null });
    expect(
      readHoldState({
        hold: expired,
        clientCaptureDeadline: created.clientCaptureDeadline,
        now: now(),
      }),
    ).toEqual({
      kind: 'possibly_expired',
    });

    const error = await expectApiError(paylov.holds.capture({ ...created, amountTiyin: 100_000 }), {
      code: 'hold_time_expired',
    });
    expect(isPaylovOutcomeUnknown(error)).toBe(false);
    expect(await paylov.holds.get(created)).toMatchObject({
      status: 'released',
      releasedAt: now(),
      capturedAt: null,
      amountTiyin: 100_000,
    });
    expect(await paylov.transactions.get(created)).toMatchObject({
      status: 'refunded',
      cancelledAt: now(),
      isHold: true,
    });
    await expectApiError(paylov.holds.release(created), { code: 'hold_not_found' });
    fake.assertDone();
  });

  it('reads a dismissed hold as refunded, still a hold, with the release time', async () => {
    const { fake, paylov, advance, now } = simulated();
    const created = await paylov.holds.create(HOLD);

    advance(1);
    await paylov.holds.release(created);
    const read = await paylov.transactions.get(created);
    expect(read).toMatchObject({ status: 'refunded', isHold: true, cancelledAt: now() });
    expect(readRefundState({ transaction: read })).toEqual({ kind: 'unknown' });
    fake.assertDone();
  });

  it('releases an expired hold without a capture attempt', async () => {
    const { fake, paylov, advance } = simulated();
    const created = await paylov.holds.create({ ...HOLD, durationMinutes: 1 });

    advance(3);
    await paylov.holds.release(created);
    expect(await paylov.holds.get(created)).toMatchObject({ status: 'released' });
    await expectApiError(paylov.holds.release(created), { code: 'hold_not_found' });
    fake.assertDone();
  });

  it('rejects a reused externalId, also after the hold was released', async () => {
    const { fake, paylov } = simulated();
    const created = await paylov.holds.create(HOLD);
    await expectApiError(paylov.holds.create(HOLD), { code: 'external_id_already_exists' });

    await paylov.holds.release(created);
    await expectApiError(paylov.holds.create(HOLD), { code: 'external_id_already_exists' });
    await expect(paylov.holds.get({ externalId: 'booking-unknown' })).resolves.toBeNull();
    fake.assertDone();
  });
});

describe('the simulated gateway: transaction list', () => {
  it('lists paid rows only, newest first, 20 to a page, by Tashkent day', async () => {
    const { fake, paylov, advance } = simulated();
    // 19:30 UTC is already the next day in Tashkent (UTC+5).
    advance(9 * 60 + 30);
    const ids: string[] = [];
    for (let index = 0; index < 23; index += 1) {
      const { transactionId } = await paylov.payments.create({ amountTiyin: 1_000 });
      await paylov.payments.pay({ transactionId, ...PAY });
      ids.push(transactionId);
      advance(1);
    }
    const { transactionId: unpaid } = await paylov.payments.create({ amountTiyin: 1_000 });
    await paylov.payments.refund({ transactionId: ids[0] ?? '' });

    const first = await paylov.transactions.list({ fromDate: '2026-11-13', toDate: '2026-11-13' });
    expect(first.total).toBe(22);
    expect(first.transactions.map((row) => row.transactionId)).toEqual(
      ids.toReversed().slice(0, 20),
    );

    const seen: string[] = [];
    for await (const row of paylov.transactions.iterate({ fromDate: '2026-11-13' })) {
      seen.push(row.transactionId);
    }
    expect(seen).toEqual(ids.slice(1).toReversed());
    expect(seen).not.toContain(unpaid);
    expect((await paylov.transactions.list({ toDate: '2026-11-12' })).total).toBe(0);
    await expectApiError(paylov.transactions.list({ fromDate: '13.11.2026' }), {
      code: 'field_not_valid',
      fields: ['beginDate'],
    });
    fake.assertDone();
  });
});

describe('the simulated gateway: evidenced refusals', () => {
  it.each([
    [
      'a pay of an unknown transaction',
      ({ paylov }: Simulated) => paylov.payments.pay({ transactionId: UNKNOWN_ID, ...PAY }),
      'transaction_not_found',
    ],
    [
      'a refund of an unknown transaction',
      ({ paylov }: Simulated) => paylov.payments.refund({ transactionId: UNKNOWN_ID }),
      'transaction_not_found',
    ],
    [
      'a capture of an unknown transaction',
      ({ paylov }: Simulated) =>
        paylov.holds.capture({ transactionId: UNKNOWN_ID, amountTiyin: 100_000 }),
      'transaction_not_found',
    ],
    [
      'a capture of a sale',
      async ({ paylov }: Simulated) => {
        const { transactionId } = await paylov.payments.create({ amountTiyin: 100_000 });
        return paylov.holds.capture({ transactionId, amountTiyin: 100_000 });
      },
      'transaction_not_available_for_payment',
    ],
    [
      'a hold on an unknown card',
      ({ paylov }: Simulated) => paylov.holds.create({ ...HOLD, cardId: UNKNOWN_ID }),
      'card_not_found',
    ],
    [
      'a list with a malformed end date',
      ({ paylov }: Simulated) => paylov.transactions.list({ toDate: '12.11.2026' }),
      'field_not_valid',
      ['endDate'],
    ],
  ])('answers %s with the gateway code', async (_case, run, code, fields?: string[]) => {
    const simulation = simulated();
    await expectApiError(run(simulation), { code, fields });
    simulation.fake.assertDone();
  });
});

describe('the simulated gateway: scripted overrides and limits', () => {
  it('serves a scripted failure first and leaves the state as it was', async () => {
    const { fake, paylov } = simulated();
    const { transactionId } = await paylov.payments.create({ amountTiyin: 100_000 });
    fake.payments.pay.fail('insufficient_funds');
    fake.payments.pay.disconnect();

    const declined = await captureAsync(paylov.payments.pay({ transactionId, ...PAY }));
    expect(declined).toMatchObject({ code: 'insufficient_funds' });
    expect(isPaylovOutcomeUnknown(declined)).toBe(false);
    const lost = await captureAsync(paylov.payments.pay({ transactionId, ...PAY }));
    expect(lost).toMatchObject({ code: 'sdk_network_error', isSent: true });
    expect(await paylov.transactions.get({ transactionId })).toMatchObject({ status: 'created' });

    await paylov.payments.pay({ transactionId, ...PAY });
    expect(await paylov.transactions.get({ transactionId })).toMatchObject({ status: 'paid' });
    expect(
      fake.calls.map((call) => call.method).filter((method) => method === 'payments.pay'),
    ).toHaveLength(3);
    fake.assertDone();
  });

  it('serves a persistent scripted reply for every call of its method', async () => {
    const { fake, paylov } = simulated();
    fake.transactions.get.reply(null, { persist: true });
    const { transactionId } = await paylov.payments.create({ amountTiyin: 100_000 });

    await expect(paylov.transactions.get({ transactionId })).resolves.toBeNull();
    await expect(paylov.transactions.get({ transactionId })).resolves.toBeNull();
    fake.assertDone();
  });

  it.each([
    [
      'a refund of a captured hold',
      async ({ paylov }: Simulated) => {
        const created = await paylov.holds.create(HOLD);
        await paylov.holds.capture({ ...created, amountTiyin: 100_000 });
        return paylov.payments.refund(created);
      },
      'payments.refund',
    ],
    [
      'a transaction read of a hold dismissed after it expired',
      async ({ paylov, advance }: Simulated) => {
        const created = await paylov.holds.create({ ...HOLD, durationMinutes: 1 });
        advance(3);
        await paylov.holds.release(created);
        return paylov.transactions.get(created);
      },
      'transactions.get',
    ],
    [
      'a capture after the card was deleted',
      async ({ paylov }: Simulated) => {
        const created = await paylov.holds.create(HOLD);
        await paylov.cards.delete({ cardId: CARD.cardId });
        return paylov.holds.capture({ ...created, amountTiyin: 100_000 });
      },
      'holds.capture',
    ],
    [
      'a refund of a hold released after it expired',
      async ({ paylov, advance }: Simulated) => {
        const created = await paylov.holds.create({ ...HOLD, durationMinutes: 1 });
        advance(2);
        await captureAsync(paylov.holds.capture({ ...created, amountTiyin: 100_000 }));
        return paylov.payments.refund(created);
      },
      'payments.refund',
    ],
    [
      'a second capture after hold_time_expired',
      async ({ paylov, advance }: Simulated) => {
        const created = await paylov.holds.create({ ...HOLD, durationMinutes: 1 });
        advance(2);
        await captureAsync(paylov.holds.capture({ ...created, amountTiyin: 100_000 }));
        return paylov.holds.capture({ ...created, amountTiyin: 100_000 });
      },
      'holds.capture',
    ],
    [
      'a hold read by the id of a sale',
      async ({ paylov }: Simulated) => {
        const { transactionId } = await paylov.payments.create({ amountTiyin: 100_000 });
        return paylov.holds.get({ transactionId });
      },
      'holds.get',
    ],
    [
      'a hold longer than 28 days',
      async ({ paylov }: Simulated) =>
        paylov.holds.create({ ...HOLD, durationMinutes: 28 * 24 * 60 + 1 }),
      'holds.create',
    ],
    [
      'a list whose range ends before it starts',
      async ({ paylov }: Simulated) =>
        paylov.transactions.list({ fromDate: '2026-11-12', toDate: '2026-11-11' }),
      'transactions.list',
    ],
    [
      'a list with a day the calendar lacks',
      async ({ paylov }: Simulated) => paylov.transactions.list({ fromDate: '2026-02-30' }),
      'transactions.list',
    ],
    [
      'a card list after a delete',
      async ({ paylov }: Simulated) => {
        await paylov.cards.delete({ cardId: CARD.cardId });
        return paylov.cards.list({ userId: CARD.userId });
      },
      'cards.list',
    ],
    [
      'a payment of zero',
      async ({ paylov }: Simulated) => paylov.payments.create({ amountTiyin: 0 }),
      'payments.create',
    ],
    [
      'a pay by a user other than the payment was created for',
      async ({ paylov }: Simulated) => {
        const { transactionId } = await paylov.payments.create({
          amountTiyin: 100_000,
          userId: 'user-7',
        });
        return paylov.payments.pay({ transactionId, ...PAY });
      },
      'payments.pay',
    ],
    [
      'a pay with an inactive card',
      async ({ fake, paylov }: Simulated) => {
        fake.addCard(INACTIVE_CARD);
        const { transactionId } = await paylov.payments.create({ amountTiyin: 100_000 });
        return paylov.payments.pay({ transactionId, ...PAY, cardId: INACTIVE_CARD.cardId });
      },
      'payments.pay',
    ],
    [
      'a hold with a serviceId',
      async ({ paylov }: Simulated) => paylov.holds.create({ ...HOLD, serviceId: SERVICE_ID }),
      'holds.create',
    ],
    [
      'a hold of less than 10 SUM',
      async ({ paylov }: Simulated) => paylov.holds.create({ ...HOLD, amountTiyin: 900 }),
      'holds.create',
    ],
    [
      'a hold on an inactive card',
      async ({ fake, paylov }: Simulated) => {
        fake.addCard(INACTIVE_CARD);
        return paylov.holds.create({ ...HOLD, cardId: INACTIVE_CARD.cardId });
      },
      'holds.create',
    ],
    [
      'a capture of less than 10 SUM',
      async ({ paylov }: Simulated) => {
        const created = await paylov.holds.create(HOLD);
        return paylov.holds.capture({ ...created, amountTiyin: 900 });
      },
      'holds.capture',
    ],
    [
      'a capture of an expired hold above the held amount',
      async ({ paylov, advance }: Simulated) => {
        const created = await paylov.holds.create({ ...HOLD, durationMinutes: 1 });
        advance(2);
        return paylov.holds.capture({ ...created, amountTiyin: 200_000 });
      },
      'holds.capture',
    ],
    [
      'a capture of a hold released after it expired',
      async ({ paylov, advance }: Simulated) => {
        const created = await paylov.holds.create({ ...HOLD, durationMinutes: 1 });
        advance(2);
        await paylov.holds.release(created);
        return paylov.holds.capture({ ...created, amountTiyin: 100_000 });
      },
      'holds.capture',
    ],
    [
      'a release of a transaction that is not a hold',
      async ({ paylov }: Simulated) => paylov.holds.release({ transactionId: UNKNOWN_ID }),
      'holds.release',
    ],
    [
      'a release after the card was deleted',
      async ({ paylov }: Simulated) => {
        const created = await paylov.holds.create(HOLD);
        await paylov.cards.delete({ cardId: CARD.cardId });
        return paylov.holds.release(created);
      },
      'holds.release',
    ],
  ])('answers %s, which has no evidence, as unsimulated', async (_case, run, method) => {
    const simulation = simulated();
    const { fake } = simulation;

    await expectApiError(run(simulation), { code: 'fake_unsimulated', httpStatus: 501 });
    expect(() => {
      fake.assertDone();
    }).toThrow(`unsimulated ${method}:`);
  });

  it('leaves methods outside the simulation scripted', async () => {
    const { fake, paylov } = simulated();
    await expectApiError(paylov.transactions.getRrn({ transactionId: CARD.cardId }), {
      code: 'fake_unscripted',
      httpStatus: 501,
    });
    expect(() => {
      fake.assertDone();
    }).toThrow('unscripted request GET /merchant/getTransactions/rrn/');
  });

  it('refuses addCard without the simulation and keeps scripted mode unchanged', async () => {
    const fake = new PaylovFakeGateway();
    expect(() => {
      fake.addCard(CARD);
    }).toThrow(TypeError);
    const paylov = new PaylovClient(fake.clientConfig);
    await expectApiError(paylov.payments.create({ amountTiyin: 100_000 }), {
      code: 'fake_unscripted',
      httpStatus: 501,
    });
  });

  it('rejects a card bound twice and options of the wrong type', () => {
    const { fake } = simulated();
    expect(() => {
      fake.addCard(CARD);
    }).toThrow(TypeError);
    // @ts-expect-error malformed JavaScript input
    expect(() => new PaylovFakeGateway({ simulate: 'yes' })).toThrow(TypeError);
    // @ts-expect-error malformed JavaScript input
    expect(() => new PaylovFakeGateway({ now: START })).toThrow(TypeError);
  });
});

// A 401 permission_denied expires the access token, so the replay needs a refresh grant.
function scriptReplay(fake: PaylovFakeGateway): void {
  fake.transactions.get.fail('permission_denied', { httpStatus: 401 });
  fake.transactions.get.reply(null);
}

describe('the fake token endpoint', () => {
  const ID = '00000000-0000-4000-8000-000000000001';

  it('falls back from a refresh answered invalid_grant to one password grant', async () => {
    const fake = new PaylovFakeGateway();
    const paylov = new PaylovClient(fake.clientConfig);
    fake.token.fail('invalid_grant', { grant: 'refresh_token' });
    scriptReplay(fake);

    await expect(paylov.transactions.get({ transactionId: ID })).resolves.toBeNull();
    expect(fake.token.requests).toEqual(['password', 'refresh_token', 'password']);
    fake.assertDone();
  });

  it('locks the client after the password grant answers invalid_grant', async () => {
    const fake = new PaylovFakeGateway();
    const paylov = new PaylovClient(fake.clientConfig);
    fake.token.fail('invalid_grant', { grant: 'password' });

    await expectApiError(paylov.transactions.get({ transactionId: ID }), {
      code: 'invalid_grant',
      httpStatus: 401,
    });
    await expectApiError(paylov.transactions.get({ transactionId: ID }), {
      code: 'invalid_grant',
      httpStatus: 401,
    });
    // The lockout answers without a second grant.
    expect(fake.token.requests).toEqual(['password']);
    fake.assertDone();
  });

  it('answers 429 with Retry-After and the client cools down', async () => {
    const fake = new PaylovFakeGateway();
    const paylov = new PaylovClient(fake.clientConfig);
    fake.token.fail('rate_limit_exceeded', { retryAfterSeconds: 48 });

    const error = await expectApiError(paylov.transactions.get({ transactionId: ID }), {
      code: 'rate_limit_exceeded',
      httpStatus: 429,
    });
    expect(error.retryAfterSeconds).toBe(48);
    await expectApiError(paylov.transactions.get({ transactionId: ID }), {
      code: 'rate_limit_exceeded',
      httpStatus: 429,
    });
    expect(fake.token.requests).toEqual(['password']);
    fake.assertDone();
  });

  it('serves a persistent failure to every token request', async () => {
    const fake = new PaylovFakeGateway();
    const paylov = new PaylovClient(fake.clientConfig);
    fake.token.fail('invalid_request', {}, { persist: true });

    for (let call = 0; call < 2; call += 1) {
      await expectApiError(paylov.transactions.get({ transactionId: ID }), {
        code: 'invalid_request',
        httpStatus: 400,
      });
    }
    expect(fake.token.requests).toEqual(['password', 'password']);
    fake.assertDone();
  });

  it('reports a persistent token answer no request took', () => {
    const fake = new PaylovFakeGateway();
    fake.token.fail('invalid_client', { grant: 'refresh_token' }, { persist: true });
    expect(() => {
      fake.assertDone();
    }).toThrow('PaylovFakeGateway: unserved persistent token answer');
  });

  it('reports a token answer no request took', () => {
    const fake = new PaylovFakeGateway();
    fake.token.fail('invalid_grant', { grant: 'refresh_token' });
    expect(() => {
      fake.assertDone();
    }).toThrow('PaylovFakeGateway: unserved token answer');
  });
});
