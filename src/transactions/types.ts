/** Parameters for `transactions.get`. */
export interface GetTransactionParams {
  readonly transactionId: string;
}

/** Parameters for `transactions.list`. */
export interface ListTransactionsParams {
  /** First day to include, `YYYY-MM-DD`, a calendar date in Tashkent time (UTC+5). */
  readonly fromDate?: string;
  /** Last day to include, `YYYY-MM-DD` in Tashkent time; the day itself is included. */
  readonly toDate?: string;
  /** 1-based page number; default 1. Pages held 20 rows on Paylov's test environment. */
  readonly page?: number;
}

/** Parameters for `transactions.iterate`: `transactions.list` without the page. */
export type IterateTransactionsParams = Omit<ListTransactionsParams, 'page'>;

/** Parameters for `transactions.getRrn`. */
export interface GetRrnParams {
  readonly transactionId: string;
}

/**
 * `created` (not yet paid), `held` (an uncaptured hold, as in `HoldStatus`), `paid` (a captured
 * hold too), `failed` (declined, a hold whose create was declined too; see `declineCode`) or
 * `refunded`. A refunded sale reads `refunded`; so does a released hold, with `isHold` true:
 * one dismissed, before or after it expired, or an expired one Paylov released when a capture
 * failed.
 * `transfer` and `pending` are documented but were never observed. Other values pass through
 * unchanged.
 */
export type TransactionStatus =
  | 'created'
  | 'held'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'transfer'
  | 'pending'
  | (string & {});

/** A fiscal (OFD) receipt attached to a transaction. */
export interface FiscalReceiptSummary {
  readonly receiptId: number;
  /** The tax authority's receipt page. */
  readonly receiptUrl: string;
  /** The time on the receipt: the payment time for a sale, the refund time for a refund. */
  readonly issuedAt: Date;
  /** `true` for the receipt of a refund. */
  readonly isRefund: boolean;
}

/** One gateway transaction: a receipt, PAN or hold payment. */
export interface Transaction {
  /** Gateway transaction id. */
  readonly transactionId: string;
  /** The external reference stored with the transaction: a hold's `externalId`; `null` for receipt and PAN payments. */
  readonly externalId: string | null;
  /** `null` for PAN payments, and for a receipt created without one until paid. */
  readonly userId: string | null;
  /** Card id; `null` until a card is attached. A PAN payment gets a new one each time. */
  readonly cardId: string | null;
  readonly maskedCardNumber: string | null;
  /** For a captured hold, the captured amount. */
  readonly amountTiyin: number;
  readonly status: TransactionStatus;
  /** The decline code of a `failed` transaction, e.g. `processing_error`; otherwise `null`. */
  readonly declineCode: string | null;
  /** The creation time, replaced by the payment or capture time once paid. */
  readonly paidOrCreatedAt: Date;
  /** When it was `refunded`; `null` otherwise. */
  readonly cancelledAt: Date | null;
  readonly isHold: boolean;
  readonly isSplit: boolean;
  readonly isA2c: boolean;
  readonly fiscalReceipts: readonly FiscalReceiptSummary[];
}

/** One page of `transactions.list`. */
export interface TransactionPage {
  /** Matching transactions across all pages, not the length of this page. */
  readonly total: number;
  /** Paid transactions only, newest payment first. */
  readonly transactions: readonly Transaction[];
}

/** Parameters for `readRefundState`. */
export interface ReadRefundStateParams {
  /** A `transactions.get` result for a sale. */
  readonly transaction: Transaction;
}

/**
 * What a `transactions.get` read establishes about the refund of a paid sale, from
 * `readRefundState`:
 * - `refunded`: the sale reads `refunded`, with the refund time.
 * - `not_refunded`: the sale still reads `paid`.
 * - `unknown`: the read proves nothing: a hold (whose `refunded` can also mark a release), a
 *   transaction that was never paid, an unobserved status, or a refund without a
 *   time. Read again later or check the Paylov business panel; never refund again on it.
 */
export type RefundState =
  | { readonly kind: 'refunded'; readonly refundedAt: Date }
  | { readonly kind: 'not_refunded' }
  | { readonly kind: 'unknown' };
