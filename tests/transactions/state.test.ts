import { describe, expect, it } from 'vitest';

import { createTransactionsResource } from '../../src/transactions/resource.js';
import { readRefundState } from '../../src/transactions/state.js';
import type { Transaction } from '../../src/transactions/types.js';
import { expectInputError } from '../helpers/asserts.js';
import { wireResponse } from '../helpers/fixtures.js';
import { setupResource } from '../helpers/testHttp.js';

// Expectations come from docs/paylov/transactions.md: a refunded sale reads `cancel` with its
// `cancel_time`, while `refunded` was seen only on an expired hold's release.
const CANCELLED_AT = new Date('2026-11-12T15:54:08Z');
const PAID_SALE: Transaction = {
  transactionId: '00000000-0000-4000-8000-000000000001',
  externalId: null,
  userId: 'user-42',
  cardId: '00000000-0000-4000-8000-000000000002',
  maskedCardNumber: '860000******0000',
  amountTiyin: 100_000,
  status: 'paid',
  declineCode: null,
  paidOrCreatedAt: new Date('2026-11-12T15:52:31Z'),
  cancelledAt: null,
  isHold: false,
  isSplit: false,
  isA2c: false,
  fiscalReceipts: [],
};

const INHERITED: unknown = Object.create({ transaction: PAID_SALE });

describe('readRefundState', () => {
  it('reads a refunded sale with its refund time', () => {
    const refunded: Transaction = { ...PAID_SALE, status: 'refunded', cancelledAt: CANCELLED_AT };
    expect(readRefundState({ transaction: refunded })).toEqual({
      kind: 'refunded',
      refundedAt: CANCELLED_AT,
    });
  });

  it('reads a sale that still reads paid as not refunded, a captured hold too', () => {
    expect(readRefundState({ transaction: PAID_SALE })).toEqual({ kind: 'not_refunded' });
    expect(readRefundState({ transaction: { ...PAID_SALE, isHold: true } })).toEqual({
      kind: 'not_refunded',
    });
  });

  it('never reads a dismissed hold, which reads refunded, as a refund', async () => {
    const { resource } = setupResource(createTransactionsResource, [
      wireResponse('transactions/get.dismissedHold.wire.json'),
    ]);
    const transaction = await resource.get({
      transactionId: '5eed0000-0000-4000-8000-000000000011',
    });

    expect(readRefundState({ transaction })).toEqual({ kind: 'unknown' });
  });

  it('decides from the one read of the transaction it validated', () => {
    let reads = 0;
    const params = {
      get transaction(): Transaction | null {
        reads += 1;
        return reads === 1 ? PAID_SALE : null;
      },
    };
    // @ts-expect-error malformed JavaScript input
    expect(readRefundState(params)).toEqual({ kind: 'not_refunded' });
    expect(reads).toBe(1);
  });

  it.each<[string, Transaction]>([
    [
      'a refunded hold, which can also mark a release',
      { ...PAID_SALE, status: 'refunded', isHold: true, cancelledAt: CANCELLED_AT },
    ],
    ['a refund without its time', { ...PAID_SALE, status: 'refunded' }],
    ['a paid sale with a cancel time', { ...PAID_SALE, cancelledAt: CANCELLED_AT }],
    ['an unpaid sale', { ...PAID_SALE, status: 'created' }],
    ['a declined sale', { ...PAID_SALE, status: 'failed', declineCode: 'processing_error' }],
    ['an uncaptured hold', { ...PAID_SALE, status: 'held', isHold: true }],
    ['the unobserved transfer status', { ...PAID_SALE, status: 'transfer' }],
    ['the unobserved pending status', { ...PAID_SALE, status: 'pending' }],
    ['a status outside the vocabulary', { ...PAID_SALE, status: 'chargeback' }],
  ])('never guesses: %s is unknown', (_case, transaction) => {
    expect(readRefundState({ transaction })).toEqual({ kind: 'unknown' });
  });

  it.each([
    ['missing params', undefined, undefined, 'type'],
    ['a missing transaction', {}, 'transaction', 'required'],
    ['an inherited transaction', INHERITED, 'transaction', 'required'],
    ['a null transaction', { transaction: null }, 'transaction', 'type'],
    ['a string transaction', { transaction: 'paid' }, 'transaction', 'type'],
  ] as const)('rejects %s', async (_case, params, field, rule) => {
    // @ts-expect-error malformed JavaScript input
    await expectInputError(() => readRefundState(params), {
      code: 'sdk_invalid_input',
      field,
      rule,
    });
  });
});
