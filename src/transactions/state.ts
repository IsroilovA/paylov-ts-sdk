/** A pure decision over a `transactions.get` result. */

import { readParams } from '../core/params.js';
import { isValidDate } from '../core/time.js';
import type { ReadRefundStateParams, RefundState } from './types.js';

const UNKNOWN: RefundState = { kind: 'unknown' };

/**
 * Turns a `transactions.get` result for a sale or a captured hold into a refund decision, without
 * I/O. Every status the SDK cannot settle maps to `unknown`, never to a guess: a hold that reads
 * `refunded` is `unknown`, since a release reads the same, and so is a `cancelledAt` that is
 * neither `null` nor a valid `Date`.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_input` for a missing transaction or one that is not
 * an object.
 *
 * @example
 * const transaction = await paylov.transactions.get({ transactionId: order.transactionId });
 * const state = readRefundState({ transaction });
 * if (state.kind === 'refunded') await orders.markRefunded(order.id, state.refundedAt);
 */
export function readRefundState(params: ReadRefundStateParams): RefundState {
  const method = 'readRefundState';
  const { status, isHold, cancelledAt } = readParams(params, method).record('transaction');
  if (status === 'paid' && cancelledAt === null) return { kind: 'not_refunded' };
  // On a hold, `refunded` marks a release, by dismissal or by Paylov after expiry.
  if (status === 'refunded' && isHold === false && isValidDate(cancelledAt)) {
    return { kind: 'refunded', refundedAt: cancelledAt };
  }
  return UNKNOWN;
}
