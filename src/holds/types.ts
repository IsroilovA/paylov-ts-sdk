import type { PaylovJsonObject } from '../core/types.js';
import type { TransactionLookup, TransactionReference } from '../shared/transactions.js';

/**
 * `held` (reserved), `captured` or `released`. `held` means what it means in `TransactionStatus`,
 * where a captured hold reads `paid` and an expired hold Paylov released has read `refunded`. An
 * expired hold can still read `held`, so `held` alone does not prove the hold can be captured.
 * Paylov also documents `created`, which has not been observed. Other values pass through
 * unchanged.
 */
export type HoldStatus = 'held' | 'captured' | 'released' | 'created' | (string & {});

/** Parameters for `holds.create`. */
export interface CreateHoldParams {
  /** Your id for the cardholder. */
  readonly userId: string;
  /** A card bound to this merchant (UUID). */
  readonly cardId: string;
  /**
   * The amount to reserve, a multiple of 100: the wire takes whole SUM. Paylov answers
   * `validation_error` below 1000 (10 SUM).
   */
  readonly amountTiyin: number;
  /**
   * How long the hold lasts, in minutes. Paylov accepts 1 to 40320 (28 days): 0 answers
   * `validation_error`, more answers `field_not_valid`.
   */
  readonly durationMinutes: number;
  /**
   * Your reference for this hold, unique per merchant; Paylov answers `validation_error` above
   * 64 characters. It is the key that finds the hold again with `holds.get({ externalId })` after
   * an ambiguous failure.
   */
  readonly externalId: string;
  /** Merchant data sent with the hold. */
  readonly account?: PaylovJsonObject;
  /** An existing Paylov service (UUID); the gateway defaults to the merchant itself. */
  readonly serviceId?: string;
}

/** Parameters for `holds.capture`. */
export interface CaptureHoldParams {
  readonly transactionId: string;
  /**
   * The amount to capture, a multiple of 100, up to the held amount. A smaller amount is a
   * partial capture; it ends the hold. Paylov answers `validation_error` below 1000 (10 SUM) and
   * `invalid_amount` above the held amount.
   */
  readonly amountTiyin: number;
}

/** Result of `holds.capture`. */
export interface HoldCaptured extends TransactionReference {
  /** The card that was charged. */
  readonly cardId: string;
  /** When the capture happened (sent in UTC). */
  readonly capturedAt: Date;
}

/** Parameters for `holds.release`. */
export interface ReleaseHoldParams {
  readonly transactionId: string;
}

/** Parameters for `holds.get`: exactly one of `transactionId` or `externalId`. */
export type GetHoldParams = TransactionLookup;

/** A hold as `holds.get` reports it. */
export interface Hold {
  readonly transactionId: string;
  readonly status: HoldStatus;
  /**
   * The held amount while `held` or `released`; the captured amount once `captured`. Keep the
   * original held amount yourself: after a partial capture it is no longer reported.
   */
  readonly amountTiyin: number;
  /** When the hold was captured (sent in UTC); `null` until then. */
  readonly capturedAt: Date | null;
  /**
   * When Paylov reports the hold released (sent in UTC): after `holds.release`, or after a capture
   * of an expired hold failed with `hold_time_expired`. `null` otherwise; expiry alone has not
   * been seen to set it.
   */
  readonly releasedAt: Date | null;
  /** The service the hold belongs to: the one sent on create, or the merchant id. */
  readonly serviceId: string;
}
