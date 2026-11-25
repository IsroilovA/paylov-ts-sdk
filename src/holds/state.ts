/** A pure decision over a `holds.get` result. */

import { isTiyin } from '../core/money.js';
import { readParams } from '../core/params.js';
import { isValidDate } from '../core/time.js';
import type { HoldState, ReadHoldStateParams } from './types.js';

const UNKNOWN: HoldState = { kind: 'unknown' };
const DECLINED: HoldState = { kind: 'declined' };

type Fields = Readonly<Record<string, unknown>>;

/**
 * Turns a `holds.get` result into a decision, without I/O. Every status the SDK cannot settle
 * maps to `unknown`, never to a guess; in particular, the deadline passing never reads as
 * released. A `declined` hold reads as declined only with its `transactions.get` read showing
 * `failed`, the decline Paylov documents. A `capturedAt` or `releasedAt` on the hold that is
 * neither `null` nor a valid `Date` reads as `unknown`.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_input` for a missing hold, a hold or transaction
 * that is not an object, or a `clientCaptureDeadline` or `now` that is not a valid `Date`.
 *
 * @example
 * const hold = await paylov.holds.get({ transactionId: booking.holdTransactionId });
 * const state = readHoldState({
 *   hold,
 *   clientCaptureDeadline: booking.holdDeadline,
 *   now: new Date(),
 * });
 * if (state.kind === 'possibly_expired') await paylov.holds.release({ transactionId: booking.holdTransactionId });
 */
export function readHoldState(params: ReadHoldStateParams): HoldState {
  const method = 'readHoldState';
  const input = readParams(params, method);
  const deadline = input.date('clientCaptureDeadline');
  const now = input.date('now');
  const hold = input.record('hold');
  const transaction = input.optionalRecord('transaction');
  return stateOf(hold, transaction, now.getTime() < deadline.getTime());
}

/** Paylov documents a transaction's `failed`, not the hold record's `check`. */
function isFailedHoldOf(transactionId: unknown, transaction: Fields | undefined): boolean {
  if (typeof transactionId !== 'string' || transaction === undefined) return false;
  const { transactionId: readId, isHold, status } = transaction;
  return readId === transactionId && isHold === true && status === 'failed';
}

function stateOf(
  hold: Fields,
  transaction: Fields | undefined,
  isBeforeDeadline: boolean,
): HoldState {
  const { transactionId, status, amountTiyin, capturedAt, releasedAt } = hold;
  const isSettled = capturedAt !== null || releasedAt !== null;
  if (status === 'declined') {
    return !isSettled && isFailedHoldOf(transactionId, transaction) ? DECLINED : UNKNOWN;
  }
  const isAmount = isTiyin(amountTiyin);
  if (status === 'captured' && isValidDate(capturedAt) && releasedAt === null && isAmount) {
    return { kind: 'captured', amountTiyin, capturedAt };
  }
  if (status === 'released' && isValidDate(releasedAt) && capturedAt === null) {
    return { kind: 'released', releasedAt };
  }
  if (isSettled || status !== 'held') return UNKNOWN;
  return isBeforeDeadline ? { kind: 'open' } : { kind: 'possibly_expired' };
}
