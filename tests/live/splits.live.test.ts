/**
 * Sandbox splits: a 1000 SUM receipt payment split in full to the merchant's own id, read back,
 * a repeated split refused, and (`PAYLOV_LIVE_REFUND=1`) the refund right after, which cancels the
 * shares. Paylov issues no other recipient id to the test merchant; its own id is the `serviceId`
 * a hold reports. Receipt resends are not exercised: telling a failed OFD submission from a pending
 * one takes waiting, and the test environment refuses refunds a few minutes after payment.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Split } from '../../src/index.js';
import {
  expectRecent,
  externalId,
  LiveCleanup,
  liveClient,
  liveGate,
  observe,
  refused,
} from '../helpers/live.js';
import { bindTestCard, uzcardTestCard, type BoundCard } from './sandboxCards.js';

const gate = await liveGate();
const writes = gate.enabled && gate.config.writes;
const testCard = writes ? await uzcardTestCard() : undefined;

const PAYMENT_TIYIN = 100_000; // 1 000 SUM
const PROBE_HOLD_TIYIN = 1_000; // 10 SUM, the hold minimum

function observeSplit(label: string, split: Split): void {
  observe(label, {
    shares: split.shares.length,
    statuses: split.shares.map((share) => share.status).join(','),
    receipt: split.receipt !== null,
  });
}

describe.skipIf(!gate.enabled)('splits reads', () => {
  if (!gate.enabled) return;
  const client = liveClient(gate.config);

  it('get of an unknown transaction is transaction_not_found', async () => {
    const error = await refused(
      'splits.get.unknown',
      client.splits.get({ transactionId: randomUUID() }),
    );
    expect(error.code).toBe('transaction_not_found');
  });
});

describe.skipIf(!writes || testCard?.ok !== true)('splits writes', () => {
  if (!gate.enabled || testCard?.ok !== true) return;
  const { config } = gate;
  const client = liveClient(config);
  const card = testCard.value;
  const cleanup = new LiveCleanup();
  let bound: BoundCard | undefined;
  let merchantId: string | undefined;
  let paidId: string | undefined;
  let isSplit = false;

  function boundCard(): BoundCard {
    if (bound === undefined) throw new Error('the splits lane has no card');
    return bound;
  }

  function paidTransactionId(): string {
    if (paidId === undefined) throw new Error('the splits lane did not pay');
    return paidId;
  }

  function recipientId(): string {
    if (merchantId === undefined) throw new Error('the splits lane has no merchant id');
    return merchantId;
  }

  /** A hold without a `serviceId` reports the merchant's own id; the hold is released at once. */
  async function readMerchantId(): Promise<string> {
    const { userId, card: holder } = boundCard();
    const { transactionId } = await client.holds.create({
      userId,
      cardId: holder.cardId,
      amountTiyin: PROBE_HOLD_TIYIN,
      durationMinutes: 1,
      externalId: externalId('split-merchant'),
    });
    cleanup.add(
      'splits.cleanup.hold',
      () => client.holds.release({ transactionId }),
      'hold_not_found',
    );
    const { serviceId } = await client.holds.get({ transactionId });
    await client.holds.release({ transactionId });
    return serviceId;
  }

  beforeAll(async () => {
    bound = await bindTestCard(client, card, 'splits', cleanup);
    merchantId = await readMerchantId();
  });

  afterAll(() => cleanup.run());

  it('a paid payment without a split reads split_not_found', async () => {
    const { userId, card: payer } = boundCard();
    const { transactionId } = await client.payments.create({
      amountTiyin: PAYMENT_TIYIN,
      account: { order_id: externalId('split') },
      userId,
    });
    await client.payments.pay({ transactionId, cardId: payer.cardId, userId });
    paidId = transactionId;

    const error = await refused('splits.get.unsplit', client.splits.get({ transactionId }));
    expect(error.code).toBe('split_not_found');
  });

  it('create splits the payment to the merchant; get reads the paid share', async () => {
    const transactionId = paidTransactionId();
    const created = await client.splits.create({
      transactionId,
      recipients: [{ recipientId: recipientId(), amountTiyin: PAYMENT_TIYIN }],
    });
    isSplit = true;
    expect(created.transactionId === transactionId, 'create returns the parent id').toBe(true);

    const split = await client.splits.get({ transactionId });
    observeSplit('splits.get.paid', split);
    expect(split.shares).toHaveLength(1);
    expect(split.shares[0]).toMatchObject({ amountTiyin: PAYMENT_TIYIN, status: 'paid' });
    expect(split.shares[0]?.recipientId === recipientId(), 'share recipient').toBe(true);
    // A receipt never reaches a matcher: a failure would print its URL and fiscal sign.
    expect(split.receipt === null, 'no receipt without items').toBe(true);
    expectRecent('splits.get.paid.createdAt', split.shares[0]?.createdAt ?? null);

    const again = await refused(
      'splits.create.repeat',
      client.splits.create({
        transactionId,
        recipients: [{ recipientId: recipientId(), amountTiyin: PAYMENT_TIYIN }],
      }),
    );
    expect(again.code).toBe('split_already_done');
  });

  it.skipIf(!config.refund)('refund of the split payment cancels every share', async () => {
    const transactionId = paidTransactionId();
    await client.payments.refund({ transactionId });
    expect(isSplit, 'the split step split the payment').toBe(true);

    const split = await client.splits.get({ transactionId });
    observeSplit('splits.get.refunded', split);
    expect(split.shares.map((share) => share.status)).toEqual(['cancelled']);

    const transaction = await client.transactions.get({ transactionId });
    // The transaction carries receipt URLs, so compare fields, never the whole record.
    expect(transaction.status).toBe('refunded');
    expect(transaction.isSplit, 'the transaction is split').toBe(true);
  });
});
