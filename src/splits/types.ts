import type { FiscalReceipt } from '../shared/fiscalReceipts.js';
import type { FiscalReceiptItem } from '../shared/receiptItems.js';

/** Parameters for `splits.create`. */
export interface CreateSplitParams {
  /**
   * The paid Paylov transaction to split (UUID), such as a payment or a captured hold; Paylov
   * answers `receipt_not_available_for_split` for an unpaid one.
   */
  readonly transactionId: string;
  /**
   * The amounts must add up to the transaction amount, else `invalid_amount`; Paylov answers
   * `validation_error` for an empty list.
   */
  readonly recipients: readonly SplitRecipient[];
}

export interface SplitRecipient {
  /** Recipient id issued by Paylov (UUID); Paylov answers `validation_error` for another shape. */
  readonly recipientId: string;
  /** Integer tiyin. */
  readonly amountTiyin: number;
  /**
   * Receipt lines carried on this recipient's share. Paylov registers one receipt for the whole
   * transaction with the OFD in the background, seconds after the split; `splits.get` reports it as
   * `receipt`. The items of all recipients must total the transaction amount, not this share's
   * amount: one recipient may carry every line. Each item needs exactly one of `tin` or `pinfl`; the
   * SDK rejects any other item as `sdk_invalid_input`.
   */
  readonly items?: readonly FiscalReceiptItem[];
}

/** Parameters for `splits.resendReceipt`. */
export interface ResendSplitReceiptParams {
  /** The split transaction (UUID). */
  readonly transactionId: string;
  /**
   * The split's recipients and amounts, with the corrected receipt lines on the recipients whose
   * share carries them. At least one recipient must carry items; the SDK rejects a list without any
   * as `sdk_invalid_input`.
   */
  readonly recipients: readonly SplitRecipient[];
}

/** The resubmission status Paylov reports. Open: Paylov may add values. */
export type SplitReceiptStatus = 'sent_to_ofd' | (string & {});

/**
 * Paylov accepted a split's receipt lines for another OFD submission. The OFD's diagnostic text
 * for the previous submission, which Paylov returns too, is not exposed.
 */
export interface SplitReceiptResent {
  /** The split transaction. */
  readonly transactionId: string;
  readonly status: SplitReceiptStatus;
}

/** Parameters for `splits.get`. */
export interface GetSplitParams {
  /** The paid transaction passed to `splits.create` (UUID). */
  readonly transactionId: string;
}

/**
 * A recipient's sub-transaction status: `paid` once split, `cancelled` once the parent transaction
 * is refunded. Open: Paylov also lists `check`, without a meaning.
 */
export type SplitRecipientStatus = 'paid' | 'cancelled' | 'check' | (string & {});

/** One recipient's share of a split transaction. */
export interface SplitShare {
  readonly recipientId: string;
  /** Integer tiyin. */
  readonly amountTiyin: number;
  readonly status: SplitRecipientStatus;
  /** Read in Tashkent time (fixed UTC+05:00), the zone Paylov's test environment uses. */
  readonly createdAt: Date;
}

/** A split transaction: its shares and its fiscal receipt. */
export interface Split {
  /** One entry per recipient sent to `splits.create`. */
  readonly shares: readonly SplitShare[];
  /**
   * The split's current fiscal receipt: the sale receipt seconds after a split with items, the
   * refund receipt seconds after the parent transaction is refunded. `null` without items, while
   * the OFD has not registered a receipt, and when registration failed.
   */
  readonly receipt: FiscalReceipt | null;
}
