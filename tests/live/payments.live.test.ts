/**
 * Sandbox payments and transactions: a receipt payment on a bound card read back through
 * `client.transactions`, a repeated pay, the full refund (`PAYLOV_LIVE_REFUND=1`), and a one-off
 * PAN payment confirmed with the test card's OTP.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PaylovClient, Transaction } from '../../src/index.js';
import {
  expectRecent,
  externalId,
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
const PAN_PAYMENT_TIYIN = 120_000; // 1 200 SUM
const LIST_PAGES = 5;

async function readTransaction(client: PaylovClient, transactionId: string): Promise<Transaction> {
  const transaction = await client.transactions.get({ transactionId });
  if (transaction === null) throw new Error('transactions.get found no such transaction');
  expect(transaction.transactionId === transactionId, 'transactionId').toBe(true);
  return transaction;
}

function observeTransaction(label: string, transaction: Transaction): void {
  observe(label, {
    status: transaction.status,
    amountTiyin: transaction.amountTiyin,
    isHold: transaction.isHold,
    isCheckout: transaction.isCheckout,
    declineCode: transaction.declineCode,
    receipts: transaction.fiscalReceipts.length,
  });
}

describe.skipIf(!gate.enabled)('transactions reads', () => {
  if (!gate.enabled) return;
  const client = liveClient(gate.config);

  it('get of an unknown transaction id is null', async () => {
    expect(await client.transactions.get({ transactionId: randomUUID() })).toBeNull();
  });

  it('list pages hold paid transactions only', async () => {
    const page = await client.transactions.list({ page: 1 });
    observe('transactions.list.page1', { total: page.total, rows: page.transactions.length });
    expect(page.total).toBeGreaterThanOrEqual(page.transactions.length);
    for (const transaction of page.transactions) expect(transaction.status).toBe('paid');
  });

  it('getRrn of an unknown transaction is transaction_not_found', async () => {
    const error = await refused(
      'transactions.getRrn.unknown',
      client.transactions.getRrn({ transactionId: randomUUID() }),
    );
    expect(error.code).toBe('transaction_not_found');
  });
});

describe.skipIf(!writes || testCard?.ok !== true)('payments writes', () => {
  if (!gate.enabled || testCard?.ok !== true) return;
  const { config } = gate;
  const client = liveClient(config);
  const card = testCard.value;
  let bound: BoundCard | undefined;
  let paidId: string | undefined;

  function boundCard(): BoundCard {
    if (bound === undefined) throw new Error('the payments lane has no card');
    return bound;
  }

  function paidTransactionId(): string {
    if (paidId === undefined) throw new Error('the receipt payment step did not pay');
    return paidId;
  }

  beforeAll(async () => {
    bound = await bindTestCard(client, card, 'payments');
  });

  afterAll(async () => {
    await bound?.release();
  });

  it('create leaves an unpaid transaction; pay settles it for the exact tiyin amount', async () => {
    const { userId, card: payer } = boundCard();
    const { transactionId } = await client.payments.create({
      amountTiyin: PAYMENT_TIYIN,
      account: { order_id: externalId('payment') },
      userId,
    });
    const created = await readTransaction(client, transactionId);
    observeTransaction('transactions.get.created', created);
    expect(created).toMatchObject({ status: 'created', amountTiyin: PAYMENT_TIYIN, isHold: false });

    const paid = await client.payments.pay({ transactionId, cardId: payer.cardId, userId });
    expect(paid.transactionId === transactionId, 'pay echoes the transactionId').toBe(true);
    paidId = transactionId;

    const settled = await readTransaction(client, transactionId);
    observeTransaction('transactions.get.paid', settled);
    expect(settled).toMatchObject({
      status: 'paid',
      amountTiyin: PAYMENT_TIYIN,
      isHold: false,
      isSplit: false,
      isA2c: false,
      isCheckout: false,
      declineCode: null,
      cancelledAt: null,
    });
    expect(settled.userId === userId, 'userId').toBe(true);
    expect(settled.cardId === payer.cardId, 'cardId').toBe(true);
    expectRecent('transactions.get.paid.paidOrCreatedAt', settled.paidOrCreatedAt);
  });

  it('getRrn reads a digit RRN for the paid payment', async () => {
    const rrn = await client.transactions.getRrn({ transactionId: paidTransactionId() });
    observe('transactions.getRrn', { length: rrn.length, digitsOnly: /^\d+$/.test(rrn) });
    expect(/^\d+$/.test(rrn)).toBe(true);
  });

  it('list contains the paid payment', async () => {
    const transactionId = paidTransactionId();
    let found: Transaction | undefined;
    for (let page = 1; page <= LIST_PAGES && found === undefined; page += 1) {
      const result = await client.transactions.list({ page });
      found = result.transactions.find((row) => row.transactionId === transactionId);
      if (result.transactions.length === 0) break;
    }
    expect(found, 'listed within the first pages').toBeDefined();
    expect(found).toMatchObject({ status: 'paid', amountTiyin: PAYMENT_TIYIN });
  });

  it('a second pay is transaction_already_payed', async () => {
    const { userId, card: payer } = boundCard();
    const error = await refused(
      'payments.pay.repeat',
      client.payments.pay({ transactionId: paidTransactionId(), cardId: payer.cardId, userId }),
    );
    expect(error.code).toBe('transaction_already_payed');
  });

  it.skipIf(!config.refund)('refund cancels the payment in full; a repeat is refused', async () => {
    const transactionId = paidTransactionId();
    const refunded = await client.payments.refund({ transactionId });
    expect(refunded.transactionId === transactionId, 'refund echoes the transactionId').toBe(true);
    expectRecent('payments.refund.refundedAt', refunded.refundedAt);

    const cancelled = await readTransaction(client, transactionId);
    observeTransaction('transactions.get.refunded', cancelled);
    expect(cancelled).toMatchObject({ status: 'refunded', amountTiyin: PAYMENT_TIYIN });
    expectRecent('transactions.get.refunded.cancelledAt', cancelled.cancelledAt);

    const again = await refused(
      'payments.refund.repeat',
      client.payments.refund({ transactionId }),
    );
    expect(again.code).toBe('transaction_not_available_for_cancel');
  });

  it('startPanPayment then confirmPanPayment pays; its getRrn is refused', async () => {
    const started = await client.payments.startPanPayment({
      cardNumber: card.pan,
      cardExpiry: card.expiry,
      amountTiyin: PAN_PAYMENT_TIYIN,
      account: { order_id: externalId('pan-payment') },
    });
    expect(started.otpSentPhone.length).toBeGreaterThan(0);

    const confirmed = await client.payments.confirmPanPayment({
      transactionId: started.transactionId,
      otp: card.otp,
    });
    expect(confirmed.transactionId === started.transactionId, 'confirm echoes the id').toBe(true);

    const paid = await readTransaction(client, started.transactionId);
    observeTransaction('transactions.get.pan-paid', paid);
    expect(paid).toMatchObject({ status: 'paid', amountTiyin: PAN_PAYMENT_TIYIN, isHold: false });
    expectRecent('transactions.get.pan-paid.paidOrCreatedAt', paid.paidOrCreatedAt);

    const rrn = await refused(
      'transactions.getRrn.pan-paid',
      client.transactions.getRrn({ transactionId: started.transactionId }),
    );
    expect(rrn.code).toBe('transaction_not_available_for_payment');
  });
});
