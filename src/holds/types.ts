import type { PaylovJsonObject } from '../core/types.js';
import type { TransactionLookup, TransactionReference } from '../shared/transactions.js';

/**
 * `held` (reserved), `captured`, `released` or `declined`. `held` means what it means in
 * `TransactionStatus`, where a captured hold reads `paid` and a released one `refunded`. An expired
 * hold can still read `held`, so `held` alone does not prove the hold can be captured. `declined`
 * is Paylov's undocumented `check`, seen on the record a declined `holds.create` leaves, whose
 * transaction reads `failed`; `readHoldState` confirms a decline with that transaction. Paylov
 * also documents `created`, which has not been observed. Other values pass through unchanged.
 */
export type HoldStatus = 'held' | 'captured' | 'released' | 'declined' | 'created' | (string & {});

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
   * an ambiguous failure. Every create that reaches Paylov uses it up, a declined one too: a new
   * attempt after a decline or release needs a new `externalId`.
   */
  readonly externalId: string;
  /** Merchant data sent with the hold. */
  readonly account?: PaylovJsonObject;
  /** An existing Paylov service (UUID); the gateway defaults to the merchant itself. */
  readonly serviceId?: string;
}

/**
 * Result of `holds.create`. Paylov returns no expiry, and an expired hold still reads `held`, so
 * the SDK computes a deadline of its own.
 */
export interface HoldCreated extends TransactionReference {
  /** The duration sent, in minutes. */
  readonly durationMinutes: number;
  /**
   * Computed by the SDK, not reported by Paylov: the client clock just before the request was
   * sent, plus `durationMinutes`. Paylov starts the hold no earlier, so this is a lower bound on
   * its real expiry: capture before this. Passing it proves nothing: the hold is released
   * only after `holds.release` succeeds or `holds.get` reads `released`.
   */
  readonly clientCaptureDeadline: Date;
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
   * The held amount while `held` or `released`; the captured amount once `captured`; the requested
   * amount, never reserved, when `declined`. Keep the original held amount yourself: after a
   * partial capture it is no longer reported.
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

/** The fields of a `transactions.get` result that settle a `declined` hold. */
export interface HoldTransactionRead {
  readonly transactionId: string;
  readonly status: string;
  readonly isHold: boolean;
}

/** Parameters for `readHoldState`. */
export interface ReadHoldStateParams {
  /** A `holds.get` result. */
  readonly hold: Hold;
  /** The `clientCaptureDeadline` that `holds.create` returned for this hold. */
  readonly clientCaptureDeadline: Date;
  /** The time to judge the deadline at, usually now. */
  readonly now: Date;
  /**
   * The `transactions.get` read of `hold.transactionId`, needed only to settle a `declined` hold:
   * it reads as declined only when this transaction reads `failed`. Omit it otherwise.
   */
  readonly transaction?: HoldTransactionRead;
}

/**
 * What a `holds.get` read establishes, from `readHoldState`:
 * - `open`: reserved and before the deadline; it can be captured.
 * - `captured`: captured once; `amountTiyin` is the captured amount, and any remainder of a
 *   partial capture can be neither captured nor released.
 * - `released`: Paylov reports the hold released; nothing is left to capture or release.
 * - `possibly_expired`: still reads `held`, but the deadline has passed. A capture may fail with
 *   `hold_time_expired`; release it if you will not capture. Not proof of release.
 * - `declined`: the hold reads `declined` and its transaction `failed`: the create was declined and
 *   reserved nothing. The `externalId` stays taken: create again only with a new one.
 * - `unknown`: the read proves nothing (an unobserved status, fields that disagree with the status,
 *   or a `declined` hold without its `failed` transaction). Read again later; never act on it.
 */
export type HoldState =
  | { readonly kind: 'open' }
  | { readonly kind: 'captured'; readonly amountTiyin: number; readonly capturedAt: Date }
  | { readonly kind: 'released'; readonly releasedAt: Date }
  | { readonly kind: 'possibly_expired' }
  | { readonly kind: 'declined' }
  | { readonly kind: 'unknown' };
