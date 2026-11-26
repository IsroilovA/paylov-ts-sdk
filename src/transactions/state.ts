/** A pure decision over a `transactions.get` result. */

import { readParams } from '../core/params.js';
import { isValidDate } from '../core/time.js';
import type { ReadRefundStateParams, RefundState } from './types.js';

const UNKNOWN: RefundState = { kind: 'unknown' };

/**
 * Turns a `transactions.get` result for a sale or a captured hold into a refund decision, without
 * I/O. Every status the SDK cannot settle maps to `unknown`, never to a guess: a hold that reads
 * `refunded` is `unknown`, since a release reads the same, unless the caller passes
 * `isCaptured: true` for a hold it captured; so is a `cancelledAt` that is neither `null` nor a
 * valid `Date`.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_input` for a missing transaction or one that is not
 * an object, or an `isCaptured` that is not a boolean.
 *
 * @example
 * const transaction = await paylov.transactions.get({ transactionId: order.transactionId });
 * // `order.capturedAt` is set once this order's hold was captured with `paylov.holds.capture`.
 * const state = readRefundState({ transaction, isCaptured: order.capturedAt !== null });
 * if (state.kind === 'refunded') await orders.markRefunded(order.id, state.refundedAt);
 */
export function readRefundState(params: ReadRefundStateParams): RefundState {
  const method = 'readRefundState';
  const input = readParams(params, method);
  const { status, isHold, cancelledAt } = input.record('transaction');
  const isCaptured = input.optionalBoolean('isCaptured') === true;
  if (status === 'paid' && cancelledAt === null) return { kind: 'not_refunded' };
  // On a hold, `refunded` also marks a release, by dismissal or by Paylov after expiry; only the
  // caller knows it captured the hold, and a captured hold cannot be released.
  const isRefund = isHold === false || (isHold === true && isCaptured);
  if (status === 'refunded' && isRefund && isValidDate(cancelledAt)) {
    return { kind: 'refunded', refundedAt: cancelledAt };
  }
  return UNKNOWN;
}
