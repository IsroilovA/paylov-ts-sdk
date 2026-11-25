/** A pure decision over a `transactions.get` result. */

import { isRecord } from '../core/decoding.js';
import { invalidInput } from '../core/errors.js';
import { readParams } from '../core/params.js';
import type { ReadRefundStateParams, RefundState, Transaction } from './types.js';

const UNKNOWN: RefundState = { kind: 'unknown' };

/**
 * Turns a `transactions.get` result for a sale into a refund decision, without I/O. Every status
 * the SDK cannot settle maps to `unknown`, never to a guess.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_input` for a missing transaction.
 *
 * @example
 * const transaction = await paylov.transactions.get({ transactionId: order.transactionId });
 * const state = readRefundState({ transaction });
 * if (state.kind === 'refunded') await orders.markRefunded(order.id, state.refundedAt);
 */
export function readRefundState(params: ReadRefundStateParams): RefundState {
  const method = 'readRefundState';
  readParams(params, method);
  const { transaction } = params;
  if (!isRecord(transaction)) {
    const message = `${method}: transaction must be a transactions.get result`;
    throw invalidInput(message, 'transaction', 'type');
  }
  return stateOf(transaction);
}

function stateOf(transaction: Transaction): RefundState {
  const { status, isHold, cancelledAt } = transaction;
  if (status === 'paid' && cancelledAt === null) return { kind: 'not_refunded' };
  // On a hold, `refunded` marks a release, by dismissal or by Paylov after expiry.
  if (status === 'refunded' && !isHold && cancelledAt instanceof Date) {
    return { kind: 'refunded', refundedAt: cancelledAt };
  }
  return UNKNOWN;
}
