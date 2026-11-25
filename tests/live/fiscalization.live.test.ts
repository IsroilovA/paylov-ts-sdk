/**
 * Sandbox fiscalization: receipt lookups, activity-type checks for the sandbox test PINFL, and a
 * receipt registered for a paid payment, which (`PAYLOV_LIVE_REFUND=1`) is refunded right away:
 * the test environment refuses refunds a few minutes after payment. The refund registers the refund
 * receipt in the background, seconds to minutes later. The item uses a public tax-classifier code
 * with one of its package codes and the vendor docs' example TIN.
 */

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FiscalActivityType, FiscalReceipt, PaylovClient } from '../../src/index.js';
import {
  expectRecent,
  externalId,
  LiveCleanup,
  liveClient,
  liveGate,
  observe,
  refused,
} from '../helpers/live.js';
import { bindTestCard, sandboxTestPinfl, uzcardTestCard, type BoundCard } from './sandboxCards.js';

const gate = await liveGate();
const writes = gate.enabled && gate.config.writes;
const testCard = writes ? await uzcardTestCard() : undefined;
const testPinfl = gate.enabled ? await sandboxTestPinfl() : undefined;

const PAYMENT_TIYIN = 100_000; // 1 000 SUM
/** The receipt time and the transaction time are the same instant, each sent in whole seconds. */
const SAME_INSTANT_MS = 5_000;
/** Waits between refund-receipt reads: about 6 minutes in all, past the 3.5 minutes observed. */
const REFUND_RECEIPT_WAITS_MS = [
  2_000, 4_000, 8_000, 16_000, 30_000, 60_000, 60_000, 60_000, 60_000, 60_000,
];
const REFUND_RECEIPT_TIMEOUT_MS = 420_000;
const ACTIVITY_TYPES: readonly FiscalActivityType[] = [
  'individual_entrepreneur',
  'self_employed',
  'high_income',
];

/** Polls until the refund receipt exists; fails after the last wait. */
async function waitForRefundReceipt(
  client: PaylovClient,
  transactionId: string,
): Promise<FiscalReceipt> {
  const startedAt = Date.now();
  for (const waitMs of REFUND_RECEIPT_WAITS_MS) {
    await sleep(waitMs);
    const receipt = await client.fiscalization.getReceipt({ transactionId, isRefund: true });
    if (receipt !== null) {
      observe('fiscalization.getReceipt.refund', {
        seconds: Math.round((Date.now() - startedAt) / 1000),
      });
      return receipt;
    }
  }
  throw new Error(
    `no refund receipt ${Math.round((Date.now() - startedAt) / 1000)} s after the refund`,
  );
}

describe.skipIf(!gate.enabled)('fiscalization reads', () => {
  if (!gate.enabled) return;
  const client = liveClient(gate.config);

  it('getReceipt of an unknown transactionId is transaction_not_found', async () => {
    const error = await refused(
      'fiscalization.getReceipt.unknown-id',
      client.fiscalization.getReceipt({ transactionId: randomUUID() }),
    );
    expect(error).toMatchObject({ kind: 'api', code: 'transaction_not_found' });
  });

  it.skipIf(testPinfl?.ok !== true)(
    'checkActivityType reads the sandbox PINFL as unconfirmed for every type',
    async () => {
      if (testPinfl?.ok !== true) return;
      for (const activityType of ACTIVITY_TYPES) {
        const check = await client.fiscalization.checkActivityType({
          pinfl: testPinfl.value,
          activityType,
        });
        observe(`fiscalization.checkActivityType.${activityType}`, {
          isConfirmed: check.isConfirmed,
          activityNames: check.activityNames.length,
        });
        expect(check).toEqual({ isConfirmed: false, activityNames: [] });
      }
    },
  );
});

describe.skipIf(!writes || testCard?.ok !== true)('fiscalization writes', () => {
  if (!gate.enabled || testCard?.ok !== true) return;
  const { config } = gate;
  const client = liveClient(config);
  const card = testCard.value;
  const cleanup = new LiveCleanup();
  let bound: BoundCard | undefined;
  let paidId: string | undefined;
  let sale: FiscalReceipt | undefined;

  function paidTransactionId(): string {
    if (paidId === undefined) throw new Error('the fiscalization lane has no paid transaction');
    return paidId;
  }

  beforeAll(async () => {
    bound = await bindTestCard(client, card, 'fiscalization', cleanup);
    const { userId, card: boundCard } = bound;
    const { transactionId } = await client.payments.create({
      amountTiyin: PAYMENT_TIYIN,
      account: { order_id: externalId('fiscal') },
      userId,
    });
    await client.payments.pay({ transactionId, cardId: boundCard.cardId, userId });
    paidId = transactionId;
  });

  afterAll(() => cleanup.run());

  it('getReceipt of a paid, unfiscalized payment is null', async () => {
    const receipt = await client.fiscalization.getReceipt({
      transactionId: paidTransactionId(),
      isRefund: false,
    });
    observe('fiscalization.getReceipt.paid', { found: receipt !== null });
    // Receipts never reach a matcher: a failure would print the receipt URL and fiscal sign.
    expect(receipt === null, 'no receipt before registration').toBe(true);
  });

  it('registerReceipt registers the sale; getReceipt reads it; a repeat is refused', async () => {
    const transactionId = paidTransactionId();
    const params = {
      transactionId,
      items: [
        {
          title: 'SDK live suite item',
          priceTiyin: PAYMENT_TIYIN,
          count: 1,
          code: '10305008003000000',
          vatPercent: 12,
          packageCode: '1546532',
          tin: '123654987',
        },
      ],
    };
    const registered = await client.fiscalization.registerReceipt(params);
    const read = await client.fiscalization.getReceipt({ transactionId, isRefund: false });
    observe('fiscalization.getReceipt.registered', { found: read !== null });
    const readsRegistered =
      read !== null &&
      !read.isRefund &&
      read.receiptId === registered.receiptId &&
      read.receiptUrl === registered.receiptUrl &&
      read.terminalId === registered.terminalId &&
      read.fiscalSign === registered.fiscalSign;
    expect(readsRegistered, 'getReceipt reads the registered sale receipt').toBe(true);

    const again = await refused(
      'fiscalization.registerReceipt.repeat',
      client.fiscalization.registerReceipt(params),
    );
    expect(again).toMatchObject({ kind: 'api', code: 'ofd_check_already_generated' });
    sale = read ?? undefined;

    const transaction = await client.transactions.get({ transactionId });
    const [summary] = transaction.fiscalReceipts;
    expect(transaction.fiscalReceipts.length, 'fiscal receipt count').toBe(1);
    const summarizesSale = summary?.receiptId === registered.receiptId && !summary.isRefund;
    expect(summarizesSale, 'the transaction lists the sale receipt').toBe(true);
    expect(summary?.issuedAt).toBeInstanceOf(Date);
    const skewMs = Math.abs(
      (summary?.issuedAt.getTime() ?? Number.NaN) - transaction.paidOrCreatedAt.getTime(),
    );
    observe('transactions.get.fiscalReceipt.issuedAt', { secondsFromPayment: skewMs / 1000 });
    expect(skewMs, 'the sale receipt carries the payment time').toBeLessThanOrEqual(
      SAME_INSTANT_MS,
    );
    expectRecent('transactions.get.fiscalReceipt.issuedAt', summary?.issuedAt ?? null);
  });

  it.skipIf(!config.refund)(
    'refund registers the refund receipt; refundReceipt is then refused',
    async () => {
      const transactionId = paidTransactionId();
      const refunded = await client.payments.refund({ transactionId });
      if (sale === undefined) throw new Error('the register step registered no sale receipt');

      const refund = await waitForRefundReceipt(client, transactionId);
      expect(refund.isRefund).toBe(true);
      expect(refund.receiptId === sale.receiptId, 'a new receipt').toBe(false);

      const transaction = await client.transactions.get({ transactionId });
      expect(transaction.status).toBe('refunded');
      expect(transaction.fiscalReceipts.map((receipt) => receipt.isRefund)).toEqual([false, true]);
      const refundSummary = transaction.fiscalReceipts[1];
      expect(refundSummary?.receiptId === refund.receiptId, 'the refund receipt is listed').toBe(
        true,
      );
      const skewMs = Math.abs(
        (refundSummary?.issuedAt.getTime() ?? Number.NaN) - refunded.refundedAt.getTime(),
      );
      expect(skewMs, 'the refund receipt carries the refund time').toBeLessThanOrEqual(
        SAME_INSTANT_MS,
      );

      const again = await refused(
        'fiscalization.refundReceipt.after-refund',
        client.fiscalization.refundReceipt({ receiptId: sale.receiptId }),
      );
      expect(again).toMatchObject({ kind: 'api', code: 'ofd_check_already_generated' });
    },
    REFUND_RECEIPT_TIMEOUT_MS,
  );
});
