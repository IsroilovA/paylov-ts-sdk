/** A pure decision over a `holds.get` result. */

import { isRecord } from '../core/decoding.js';
import { invalidInput } from '../core/errors.js';
import { readParams } from '../core/params.js';
import type { Hold, HoldState, HoldTransactionRead, ReadHoldStateParams } from './types.js';

const UNKNOWN: HoldState = { kind: 'unknown' };
const DECLINED: HoldState = { kind: 'declined' };

/**
 * Turns a `holds.get` result into a decision, without I/O. Every status the SDK cannot settle
 * maps to `unknown`, never to a guess; in particular, the deadline passing never reads as
 * released. A `declined` hold reads as declined only with its `transactions.get` read showing
 * `failed`, the decline Paylov documents.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_input` for a missing hold, a hold or transaction
 * that is not an object, or an invalid `Date`.
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
  const { hold, transaction } = params;
  if (!isRecord(hold)) {
    throw invalidInput(`${method}: hold must be a holds.get result`, 'hold', 'type');
  }
  if (transaction !== undefined && !isRecord(transaction)) {
    const message = `${method}: transaction must be a transactions.get result`;
    throw invalidInput(message, 'transaction', 'type');
  }
  if (hold.status === 'declined') return isDeclineConfirmed(hold, transaction) ? DECLINED : UNKNOWN;
  return stateOf(hold, now.getTime() < deadline.getTime());
}

/** Paylov documents a transaction's `failed`, not the hold record's `check`. */
function isDeclineConfirmed(hold: Hold, transaction: HoldTransactionRead | undefined): boolean {
  if (hold.capturedAt !== null || hold.releasedAt !== null || transaction === undefined) {
    return false;
  }
  const { transactionId, isHold, status } = transaction;
  return transactionId === hold.transactionId && isHold && status === 'failed';
}

function stateOf(hold: Hold, isBeforeDeadline: boolean): HoldState {
  const { status, capturedAt, releasedAt, amountTiyin } = hold;
  if (status === 'captured' && capturedAt instanceof Date && releasedAt === null) {
    return { kind: 'captured', amountTiyin, capturedAt };
  }
  if (status === 'released' && releasedAt instanceof Date && capturedAt === null) {
    return { kind: 'released', releasedAt };
  }
  if (capturedAt !== null || releasedAt !== null || status !== 'held') return UNKNOWN;
  return isBeforeDeadline ? { kind: 'open' } : { kind: 'possibly_expired' };
}
