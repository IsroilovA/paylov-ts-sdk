import type { FiscalReceiptRegistered } from '../shared/fiscalReceipts.js';
import type { FiscalReceiptItem } from '../shared/receiptItems.js';

/** Parameters for `fiscalization.registerReceipt`. */
export interface RegisterFiscalReceiptParams {
  /** The paid Paylov card payment (UUID). */
  readonly transactionId: string;
  /** Receipt lines; their total must equal the transaction amount. */
  readonly items: readonly FiscalReceiptItem[];
}

/** Parameters for `fiscalization.getReceipt`. */
export interface GetFiscalReceiptParams {
  /** The card payment (UUID). */
  readonly transactionId: string;
  /**
   * `true` reads the refund receipt, `false` the sale receipt. Omitted, Paylov returns the refund
   * receipt once one exists, otherwise the sale receipt.
   */
  readonly isRefund?: boolean;
}

/** Parameters for `fiscalization.refundReceipt`. */
export interface RefundFiscalReceiptParams {
  /** The sale receipt to reverse. */
  readonly receiptId: number;
}

/** The OFD refund receipt and the sale receipt it reverses. */
export interface FiscalReceiptRefunded {
  /** The new refund receipt. */
  readonly refund: FiscalReceiptRegistered;
  /** The original sale receipt; its `receiptId` is the one sent. */
  readonly sale: FiscalReceiptRegistered;
}

/**
 * The tax-service status to check: an individual entrepreneur (YATT), a self-employed person, or
 * income above 100 million (currency and period undocumented).
 */
export type FiscalActivityType = 'individual_entrepreneur' | 'self_employed' | 'high_income';

/** Parameters for `fiscalization.checkActivityType`. */
export interface CheckActivityTypeParams {
  /**
   * The person's PINFL, 14 digits; Paylov answers `validation_error` for a shorter one. Personal
   * data; never logged or quoted.
   */
  readonly pinfl: string;
  readonly activityType: FiscalActivityType;
}

/** The tax service's answer. Its free-text `reason` is withheld. */
export interface ActivityTypeCheck {
  /**
   * Whether the tax service confirmed the activity type, for every activity type. Paylov's examples
   * do not define which answer field carries the result; this is the SDK's reading of them.
   */
  readonly isConfirmed: boolean;
  /** `high_income` only: the activity names the tax service lists, otherwise empty. */
  readonly activityNames: readonly string[];
}
