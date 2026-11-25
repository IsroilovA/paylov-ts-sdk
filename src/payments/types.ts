import type { PaylovJsonObject } from '../core/types.js';
import type { TransactionReference } from '../shared/transactions.js';

/** Parameters for `payments.create`. */
export interface CreatePaymentParams {
  /**
   * A multiple of 100: the wire takes whole SUM. Paylov answers `field_not_valid` for 0 or an
   * amount out of its range.
   */
  readonly amountTiyin: number;
  /**
   * Merchant data stored with the transaction. Transaction reads do not return it, so keep your
   * own mapping from order to transaction. Plain JSON only: finite numbers, no `BigInt`, `Date`, class instance, function, symbol or
   * cycle, at most 64 levels deep; `undefined` properties are dropped.
   */
  readonly account?: PaylovJsonObject;
  /** Your id for the payer. When omitted, `pay` sets it. */
  readonly userId?: string;
}

/** Parameters for `payments.pay`. */
export interface PayPaymentParams {
  /** From `payments.create`. */
  readonly transactionId: string;
  /** A card bound to `userId`. */
  readonly cardId: string;
  /** The user the card is bound to. */
  readonly userId: string;
}

/** Parameters for `payments.refund`. */
export interface RefundPaymentParams {
  readonly transactionId: string;
}

/** Parameters for `payments.startPanPayment`. */
export interface StartPanPaymentParams {
  /**
   * Full card number. PCI scope: the SDK keeps it out of logger events and errors; never log or
   * store it.
   */
  readonly cardNumber: string;
  /**
   * Card expiry as `YYMM`, year first, e.g. `2911` for November 2029; Paylov answers
   * `validation_error` for `MMYY`.
   */
  readonly cardExpiry: string;
  /** A multiple of 100: the wire takes whole SUM. Paylov answers `invalid_amount` for 0. */
  readonly amountTiyin: number;
  /**
   * Merchant data stored with the transaction; transaction reads do not return it. Plain JSON only: finite numbers, no `BigInt`, `Date`, class instance, function, symbol or
   * cycle, at most 64 levels deep; `undefined` properties are dropped.
   */
  readonly account?: PaylovJsonObject;
}

/** Parameters for `payments.confirmPanPayment`. */
export interface ConfirmPanPaymentParams {
  /** From `payments.startPanPayment`. */
  readonly transactionId: string;
  /** The code the cardholder received by SMS. */
  readonly otp: string;
}

/** The result of `payments.refund`. */
export interface PaymentRefunded extends TransactionReference {
  /** When the refund happened; `transactions.get` then reads it as `cancelledAt`. */
  readonly refundedAt: Date;
}

/**
 * The result of `payments.startPanPayment`; pass its `transactionId` to
 * `payments.confirmPanPayment`.
 */
export interface PanPaymentStarted extends TransactionReference {
  /** The masked phone the card's processing center sent the OTP to, e.g. `+9989*****00`. */
  readonly otpSentPhone: string;
}
