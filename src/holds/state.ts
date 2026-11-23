/** A pure decision over a `holds.get` result. */

import { invalidInput } from '../core/errors.js';
import { readParams } from '../core/params.js';
import type { Hold, HoldState, ReadHoldStateParams } from './types.js';

const UNKNOWN: HoldState = { kind: 'unknown' };

/**
 * Turns a `holds.get` result into a decision, without I/O. Every status the SDK cannot settle
 * maps to `unknown`, never to a guess; in particular, the deadline passing never reads as
 * released.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_input` for a missing hold or an invalid `Date`.
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
  const { hold } = params;
  if (hold === null) return UNKNOWN;
  const value: unknown = hold;
  if (typeof value !== 'object') {
    throw invalidInput(`${method}: hold must be a holds.get result or null`, 'hold', 'type');
  }
  return stateOf(hold, now.getTime() < deadline.getTime());
}

function stateOf(hold: Hold, isBeforeDeadline: boolean): HoldState {
  const { status, capturedAt, releasedAt, amountTiyin } = hold;
  if (status === 'captured' && capturedAt instanceof Date && releasedAt === null) {
    return { kind: 'captured', amountTiyin, capturedAt };
  }
  if (status === 'released' && releasedAt instanceof Date && capturedAt === null) {
    return { kind: 'released', releasedAt };
  }
  if (status !== 'held' || capturedAt !== null || releasedAt !== null) return UNKNOWN;
  return isBeforeDeadline ? { kind: 'open' } : { kind: 'possibly_expired' };
}
