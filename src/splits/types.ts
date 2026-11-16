import type { FiscalReceiptItem } from '../shared/receiptItems.js';

/** Parameters for `splits.create`. */
export interface CreateSplitParams {
  /** The paid Paylov transaction to split (UUID). */
  readonly transactionId: string;
  /**
   * The amounts must add up to the transaction amount, else `invalid_amount`; Paylov answers
   * `validation_error` for an empty list.
   */
  readonly recipients: readonly SplitRecipient[];
  /**
   * Sent as Paylov's `resendOFD`: resend the split to the fiscal system. Paylov says to resend when
   * the response lacks fiscal data, without saying where that data appears.
   */
  readonly resendOfd?: boolean;
}

export interface SplitRecipient {
  /** Opaque recipient id issued by Paylov. */
  readonly recipientId: string;
  /** Integer tiyin. */
  readonly amountTiyin: number;
  /** Receipt lines for this recipient's share; sending them starts OFD fiscalization. */
  readonly items?: readonly FiscalReceiptItem[];
}

/** Parameters for `splits.get`. */
export interface GetSplitParams {
  /** The paid transaction passed to `splits.create` (UUID). */
  readonly transactionId: string;
}

/** A recipient's sub-transaction status. Open: Paylov may add values. */
export type SplitRecipientStatus = 'paid' | 'cancelled' | 'check' | (string & {});

/** One recipient's share of a split transaction. */
export interface SplitShare {
  readonly recipientId: string;
  /** Integer tiyin. */
  readonly amountTiyin: number;
  readonly status: SplitRecipientStatus;
  /** `YYYY-MM-DD HH:MM:SS` verbatim; the time zone is undocumented. */
  readonly createdAtRaw: string;
}
