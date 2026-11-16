import type { FiscalReceiptItem } from '../shared/receiptItems.js';
import type { TransactionLookup } from '../shared/transactions.js';

/** Parameters for `fiscalization.registerReceipt` for a paid Paylov card payment. */
export interface RegisterCardFiscalReceiptParams {
  /** The paid Paylov transaction (UUID). */
  readonly transactionId: string;
  /** Receipt lines; their total must equal the transaction amount. */
  readonly items: readonly FiscalReceiptItem[];
  // `?: undefined`, not `?: never`, so params built by spread still type-check under
  // `exactOptionalPropertyTypes`.
  readonly externalId?: undefined;
  readonly phoneNumber?: undefined;
}

/** Parameters for `fiscalization.registerReceipt` for a cash sale made outside Paylov. */
export interface RegisterCashFiscalReceiptParams {
  /** Your own receipt id, the key `getReceipt` reads it back by. */
  readonly externalId: string;
  /** The customer's phone, `+998XXXXXXXXX`. Personal data; never logged or quoted. */
  readonly phoneNumber: string;
  /** Receipt lines. */
  readonly items: readonly FiscalReceiptItem[];
  readonly transactionId?: undefined;
}

/** A card payment by `transactionId`, or a cash sale by `externalId` and `phoneNumber`. */
export type RegisterFiscalReceiptParams =
  | RegisterCardFiscalReceiptParams
  | RegisterCashFiscalReceiptParams;

/**
 * Parameters for `fiscalization.getReceipt`: a card payment's `transactionId`, or the `externalId`
 * a cash sale was registered with.
 */
export type GetFiscalReceiptParams = TransactionLookup & {
  /**
   * `true` reads the refund receipt, `false` the sale receipt. Omit it to send no filter; which
   * receipt Paylov then returns for a refunded transaction is not documented.
   */
  readonly isRefund?: boolean;
};

/** A fiscal receipt the OFD registered. */
export interface FiscalReceipt {
  /** OFD receipt id; keep it with its `transactionId` or `externalId`. */
  readonly receiptId: number;
  /** Public receipt page on `ofd.soliq.uz`. */
  readonly receiptUrl: string;
  readonly terminalId: string;
  readonly fiscalSign: string;
  /** Whether this is a refund receipt rather than a sale receipt. */
  readonly isRefund: boolean;
}

/** A receipt the OFD just registered; registration does not report `isRefund`. */
export type FiscalReceiptRegistered = Omit<FiscalReceipt, 'isRefund'>;

/**
 * Parameters for `fiscalization.attachReceipt`: a receipt the merchant fiscalized itself, for a
 * paid Paylov transaction.
 */
export interface AttachFiscalReceiptParams {
  /** The paid Paylov transaction (UUID). */
  readonly transactionId: string;
  /** OFD terminal id; Paylov documents at most 32 characters. */
  readonly terminalId: string;
  /** When the receipt was issued, `YYYYMMDDHHMMSS`, as Paylov documents it. */
  readonly issuedAtRaw: string;
  /** Fiscal signature; Paylov documents at most 64 characters. */
  readonly fiscalSign: string;
  /** The receipt's `https://ofd.soliq.uz/...` page. */
  readonly receiptUrl: string;
  /** OFD receipt id; Paylov answers `validation_error` for 0. */
  readonly receiptId: number;
  /** Your own receipt id; unique per merchant. */
  readonly externalId?: string;
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
