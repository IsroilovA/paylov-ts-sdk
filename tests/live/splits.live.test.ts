/**
 * Sandbox splits between the merchant's own id (the `serviceId` a hold reports) and the recipient
 * Paylov issued it (`PAYLOV_SPLIT_RECIPIENT_ID`). A 1000 SUM receipt payment is refused an unknown
 * recipient and a share below 10 tiyin, then split, read back and refused a repeat. A second one is
 * split with every receipt line on a 10 tiyin share and read until the OFD registers its receipt.
 * With `PAYLOV_LIVE_REFUND=1` both are refunded right after: the test environment refuses refunds a
 * few minutes after payment. Receipt resends are not exercised: telling a failed OFD submission
 * from a pending one takes waiting. A partially captured hold is split for its captured amount;
 * the test environment refuses refunds of captured holds, so it stays split.
 */

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PaylovClient, Split, SplitRecipient } from '../../src/index.js';
import {
  expectRecent,
  externalId,
  LiveCleanup,
  liveClient,
  liveGate,
  note,
  observe,
  refused,
} from '../helpers/live.js';
import { bindTestCard, uzcardTestCard, type BoundCard } from './sandboxCards.js';

const gate = await liveGate();
const writes = gate.enabled && gate.config.writes;
const testCard = writes ? await uzcardTestCard() : undefined;

const PAYMENT_TIYIN = 100_000; // 1 000 SUM
const MERCHANT_SHARE_TIYIN = 40_000;
const ISSUED_SHARE_TIYIN = PAYMENT_TIYIN - MERCHANT_SHARE_TIYIN;
const HOLD_TIYIN = 2_000; // 20 SUM
const CAPTURE_TIYIN = 1_000; // 10 SUM, the smallest capture
/** The smallest share Paylov accepts. */
const MIN_SHARE_TIYIN = 10;
/** Waits between receipt reads: about 40 s in all; DEV registered split receipts within 7 s. */
const RECEIPT_WAITS_MS = [2_000, 3_000, 5_000, 10_000, 20_000];
const RECEIPT_TIMEOUT_MS = 60_000;
const ITEM = {
  title: 'SDK live suite item',
  priceTiyin: PAYMENT_TIYIN,
  count: 1,
  code: '10305008003000000',
  vatPercent: 12,
  packageCode: '1546532',
  tin: '123654987',
};
const PROBE_HOLD_TIYIN = 1_000; // 10 SUM, the hold minimum

function observeSplit(label: string, split: Split): void {
  observe(label, {
    shares: split.shares.length,
    statuses: split.shares.map((share) => share.status).join(','),
    receipt: split.receipt !== null,
  });
}

/** Reads the split until it carries a receipt of the wanted kind; fails after the last wait. */
async function waitForReceipt(
  client: PaylovClient,
  transactionId: string,
  isRefund: boolean,
): Promise<Split> {
  const startedAt = Date.now();
  for (const waitMs of RECEIPT_WAITS_MS) {
    await sleep(waitMs);
    const split = await client.splits.get({ transactionId });
    if (split.receipt?.isRefund === isRefund) {
      observe('splits.get.receipt', {
        isRefund,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      });
      return split;
    }
  }
  throw new Error(`no split receipt ${Math.round((Date.now() - startedAt) / 1000)} s later`);
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

const issuedRecipientId = gate.enabled ? gate.config.splitRecipientId : undefined;
if (writes && issuedRecipientId === undefined) {
  note('splits writes skipped: PAYLOV_SPLIT_RECIPIENT_ID is unset');
}

const splitWrites = writes && testCard?.ok === true && issuedRecipientId !== undefined;

describe.skipIf(!splitWrites)('splits writes', () => {
  if (!gate.enabled || testCard?.ok !== true || issuedRecipientId === undefined) return;
  const issuedId = issuedRecipientId;
  const { config } = gate;
  const client = liveClient(config);
  const card = testCard.value;
  const cleanup = new LiveCleanup();
  let bound: BoundCard | undefined;
  let merchantId: string | undefined;
  let paidId: string | undefined;
  let isSplit = false;
  let fiscalPaidId: string | undefined;

  function boundCard(): BoundCard {
    if (bound === undefined) throw new Error('the splits lane has no card');
    return bound;
  }

  function paidTransactionId(): string {
    if (paidId === undefined) throw new Error('the splits lane did not pay');
    return paidId;
  }

  /** A share for the merchant's own id, then one for the issued recipient. */
  function splitBetween(
    merchantTiyin: number,
    issuedTiyin: number,
    issuedItems?: SplitRecipient['items'],
  ): SplitRecipient[] {
    if (merchantId === undefined) throw new Error('the splits lane has no merchant id');
    return [
      { recipientId: merchantId, amountTiyin: merchantTiyin },
      {
        recipientId: issuedId,
        amountTiyin: issuedTiyin,
        ...(issuedItems && { items: issuedItems }),
      },
    ];
  }

  const recipients = (): SplitRecipient[] => splitBetween(MERCHANT_SHARE_TIYIN, ISSUED_SHARE_TIYIN);

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

  /** Pays 1000 SUM with the bound card and returns the paid transaction. */
  async function payNew(label: string): Promise<string> {
    const { userId, card: payer } = boundCard();
    const { transactionId } = await client.payments.create({
      amountTiyin: PAYMENT_TIYIN,
      account: { order_id: externalId(label) },
      userId,
    });
    await client.payments.pay({ transactionId, cardId: payer.cardId, userId });
    return transactionId;
  }

  it('a paid payment without a split reads split_not_found', async () => {
    const transactionId = await payNew('split');
    paidId = transactionId;

    const error = await refused('splits.get.unsplit', client.splits.get({ transactionId }));
    expect(error.code).toBe('split_not_found');
  });

  it('create refuses an unknown recipient and a share below 10 tiyin', async () => {
    const transactionId = paidTransactionId();
    const [merchantShare] = recipients();
    if (merchantShare === undefined) throw new Error('the splits lane has no merchant share');
    const unknown = await refused(
      'splits.create.unknownRecipient',
      client.splits.create({
        transactionId,
        recipients: [merchantShare, { recipientId: randomUUID(), amountTiyin: ISSUED_SHARE_TIYIN }],
      }),
    );
    expect(unknown.code).toBe('recipient_not_found');

    const belowMinimum = await refused(
      'splits.create.belowMinimum',
      client.splits.create({
        transactionId,
        recipients: splitBetween(PAYMENT_TIYIN - MIN_SHARE_TIYIN + 1, MIN_SHARE_TIYIN - 1),
      }),
    );
    expect(belowMinimum).toMatchObject({
      code: 'validation_error',
      fields: ['recipients.1.amount'],
    });
  });

  it('create splits the payment between the merchant and the issued recipient', async () => {
    const transactionId = paidTransactionId();
    const created = await client.splits.create({ transactionId, recipients: recipients() });
    isSplit = true;
    expect(created.transactionId === transactionId, 'create returns the parent id').toBe(true);

    const split = await client.splits.get({ transactionId });
    observeSplit('splits.get.paid', split);
    // Ids never reach a matcher: compare them as booleans so a failure prints no id.
    const sameRecipients = split.shares.every(
      (share, index) => share.recipientId === recipients()[index]?.recipientId,
    );
    expect(sameRecipients, 'shares follow the request order').toBe(true);
    expect(split.shares.map(({ amountTiyin, status }) => ({ amountTiyin, status }))).toEqual([
      { amountTiyin: MERCHANT_SHARE_TIYIN, status: 'paid' },
      { amountTiyin: ISSUED_SHARE_TIYIN, status: 'paid' },
    ]);
    // A receipt never reaches a matcher: a failure would print its URL and fiscal sign.
    expect(split.receipt === null, 'no receipt without items').toBe(true);
    expectRecent('splits.get.paid.createdAt', split.shares[0]?.createdAt ?? null);

    const again = await refused(
      'splits.create.repeat',
      client.splits.create({ transactionId, recipients: recipients() }),
    );
    expect(again.code).toBe('split_already_done');
  });

  it.skipIf(!config.refund)('refund of the split payment cancels every share', async () => {
    const transactionId = paidTransactionId();
    await client.payments.refund({ transactionId });
    expect(isSplit, 'the split step split the payment').toBe(true);

    const split = await client.splits.get({ transactionId });
    observeSplit('splits.get.refunded', split);
    expect(split.shares.map((share) => share.status)).toEqual(['cancelled', 'cancelled']);

    const transaction = await client.transactions.get({ transactionId });
    // The transaction carries receipt URLs, so compare fields, never the whole record.
    expect(transaction.status).toBe('refunded');
    expect(transaction.isSplit, 'the transaction is split').toBe(true);
  });

  it('a partially captured hold splits its captured amount', async () => {
    const { userId, card: holder } = boundCard();
    const { transactionId } = await client.holds.create({
      userId,
      cardId: holder.cardId,
      amountTiyin: HOLD_TIYIN,
      durationMinutes: 5,
      externalId: externalId('split-hold'),
    });
    cleanup.add(
      'splits.cleanup.captureHold',
      () => client.holds.release({ transactionId }),
      'hold_not_found',
    );
    await client.holds.capture({ transactionId, amountTiyin: CAPTURE_TIYIN });

    const held = await refused(
      'splits.create.heldAmount',
      client.splits.create({
        transactionId,
        recipients: splitBetween(HOLD_TIYIN / 2, HOLD_TIYIN / 2),
      }),
    );
    expect(held.code).toBe('invalid_amount');

    await client.splits.create({
      transactionId,
      recipients: splitBetween(CAPTURE_TIYIN / 2, CAPTURE_TIYIN / 2),
    });
    const split = await client.splits.get({ transactionId });
    observeSplit('splits.get.capturedHold', split);
    expect(split.shares.map(({ amountTiyin, status }) => ({ amountTiyin, status }))).toEqual([
      { amountTiyin: CAPTURE_TIYIN / 2, status: 'paid' },
      { amountTiyin: CAPTURE_TIYIN / 2, status: 'paid' },
    ]);
  });

  it(
    'a 10 tiyin share carrying every receipt line registers one receipt',
    async () => {
      const transactionId = await payNew('split-fiscal');
      await client.splits.create({
        transactionId,
        recipients: splitBetween(PAYMENT_TIYIN - MIN_SHARE_TIYIN, MIN_SHARE_TIYIN, [ITEM]),
      });
      fiscalPaidId = transactionId;

      const split = await waitForReceipt(client, transactionId, false);
      observeSplit('splits.get.fiscal', split);
      expect(split.shares.map(({ amountTiyin }) => amountTiyin)).toEqual([
        PAYMENT_TIYIN - MIN_SHARE_TIYIN,
        MIN_SHARE_TIYIN,
      ]);
    },
    RECEIPT_TIMEOUT_MS,
  );

  it.skipIf(!config.refund)(
    'refund of the fiscalized split registers its refund receipt',
    async () => {
      if (fiscalPaidId === undefined) throw new Error('the fiscal split step did not split');
      await client.payments.refund({ transactionId: fiscalPaidId });

      const split = await waitForReceipt(client, fiscalPaidId, true);
      observeSplit('splits.get.fiscalRefunded', split);
      expect(split.shares.map((share) => share.status)).toEqual(['cancelled', 'cancelled']);
    },
    RECEIPT_TIMEOUT_MS,
  );
});
