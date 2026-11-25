import { readCall, send } from '../core/call.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { decodeTransactionReference, type TransactionReference } from '../shared/transactions.js';
import { decodePanPaymentStarted, decodePaymentRefunded } from './decoders.js';
import type {
  ConfirmPanPaymentParams,
  CreatePaymentParams,
  PanPaymentStarted,
  PaymentRefunded,
  PayPaymentParams,
  RefundPaymentParams,
  StartPanPaymentParams,
} from './types.js';

export const ENDPOINTS = {
  create: { method: 'POST', route: '/merchant/receipts/create/', shape: 'envelope' },
  pay: {
    method: 'POST',
    route: '/merchant/receipts/pay/',
    shape: 'envelope',
    movesMoney: true,
  },
  refund: {
    method: 'POST',
    route: '/merchant/payment/cancel/',
    shape: 'envelope',
    movesMoney: true,
  },
  startPanPayment: {
    method: 'POST',
    route: '/merchant/paymentWithoutRegistration/',
    shape: 'envelope',
  },
  confirmPanPayment: {
    method: 'POST',
    route: '/merchant/confirmPayment/',
    shape: 'envelope',
    movesMoney: true,
  },
} as const;

/** The `paylov.payments` namespace. */
export interface PaymentsResource {
  /**
   * Creates an unpaid payment transaction for a saved card. **No money moves**; charge it with
   * {@link PaymentsResource.pay}.
   *
   * Each call creates a new transaction, and an unpaid one is never charged, so after any
   * failure just call again.
   *
   * @throws {@link PaylovApiError} `field_not_valid` (an amount outside the gateway's range),
   * `validation_error`.
   *
   * @example
   * const { transactionId } = await paylov.payments.create({
   *   amountTiyin: 2_500_000, // 25 000.00 SUM
   *   account: { order_id: 'A-1024' },
   *   userId: 'user-42',
   * });
   */
  create(params: CreatePaymentParams, options?: PaylovCallOptions): Promise<TransactionReference>;

  /**
   * Charges a saved card for a transaction from {@link PaymentsResource.create}, for the amount
   * fixed there. **Moves money**; no OTP is involved. A declined charge leaves the transaction
   * either `failed`, with the code in `declineCode`, which can never be paid again, or still
   * `created`, which another card can pay.
   *
   * Recovery: after a decline or when `isPaylovOutcomeUnknown(error)`, read
   * `paylov.transactions.get` before acting again; never repeat `pay` blindly. A repeated `pay`
   * of a paid transaction fails with `transaction_already_payed`, of a `failed` one with
   * `transaction_not_available_for_payment`. Paylov does not document whether a pay can still land
   * while the status reads `created`; the SDK assumes a status that stays `created` across
   * repeated reads means the pay did not take effect: pay again with the same `transactionId`,
   * never a new transaction.
   *
   * @throws {@link PaylovApiError} `transaction_already_payed`,
   * `transaction_not_available_for_payment` (refunded, failed or not payable),
   * `card_is_not_for_this_check` (the card belongs to another user), `card_not_found`, and
   * declines such as `insufficient_funds`; `processing_error` (an unknown outcome: read the
   * transaction before paying again).
   *
   * @example
   * await paylov.payments.pay({ transactionId, cardId, userId: 'user-42' });
   */
  pay(params: PayPaymentParams, options?: PaylovCallOptions): Promise<TransactionReference>;

  /**
   * Refunds a paid transaction **in full**; there is no partial refund. **Moves money back** to
   * the card. For a fiscalized payment Paylov then registers the refund (OFD) receipt within
   * seconds to minutes; read it with `fiscalization.getReceipt`. Release an uncaptured hold with
   * `holds.release` instead.
   *
   * Paylov states that saved-card and PAN payments and captured holds are refundable, but its test
   * environment refused PAN payments and captured holds. If a refund is refused, refund from the
   * Paylov business panel or through Paylov support, and confirm with `paylov.transactions.get`.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `paylov.transactions.get`: a refunded
   * transaction reads status `refunded` with `cancelledAt`. A repeated refund fails with
   * `transaction_not_available_for_cancel`.
   *
   * @throws {@link PaylovApiError} `transaction_not_available_for_cancel` (already refunded or
   * never paid; Paylov's test environment also answers it for a PAN payment), `processing_error` (an unknown outcome; Paylov's test
   * environment answers it for a captured hold and the transaction then still reads `paid`: refund
   * through the Paylov business panel, not by repeating the call), `transaction_not_found`,
   * `permission_denied`.
   *
   * @example
   * const { refundedAt } = await paylov.payments.refund({ transactionId });
   */
  refund(params: RefundPaymentParams, options?: PaylovCallOptions): Promise<PaymentRefunded>;

  /**
   * PCI scope: takes a full card number server-side; the SDK keeps it and the expiry out of
   * logger events and errors.
   *
   * Starts a one-off payment by card number, without binding the card. **No money moves yet**:
   * the card's processing center (Uzcard or Humo, not Paylov) sends an OTP by SMS to the phone
   * linked to the card. Finish with {@link PaymentsResource.confirmPanPayment}. A card without
   * SMS notifications never receives the OTP.
   *
   * Recovery: each call creates a new transaction and an unconfirmed one is never charged, so
   * after any failure start again.
   *
   * @throws {@link PaylovApiError} `card_not_found` (wrong number or expiry), `invalid_amount`.
   *
   * @example
   * const started = await paylov.payments.startPanPayment({
   *   cardNumber: cardNumberFromSecureInput,
   *   cardExpiry: cardExpiryFromSecureInput, // YYMM
   *   amountTiyin: 120_000, // 1 200.00 SUM
   *   account: { order_id: 'A-1025' },
   * });
   * showOtpPrompt(`Uzcard/Humo sent a code to ${started.otpSentPhone}`);
   */
  startPanPayment(
    params: StartPanPaymentParams,
    options?: PaylovCallOptions,
  ): Promise<PanPaymentStarted>;

  /**
   * Confirms a payment from {@link PaymentsResource.startPanPayment} with the cardholder's OTP.
   * **Moves money.** A wrong OTP fails with `invalid_otp` and can be retried with the right one.
   * On Paylov's test environment an OTP lasts about 90 seconds, and the fourth wrong OTP blocks
   * the card for about five minutes, for payments and bindings alike: `card_is_blocked`, with the
   * rest of the block in `retryAfterSeconds`. Stop prompting before that.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `paylov.transactions.get` before acting
   * again. A repeated confirm of a paid transaction fails with `otp_expired`, the same code as a
   * really expired OTP, so only the read tells them apart.
   *
   * @throws {@link PaylovApiError} `invalid_otp`, `otp_expired`, `card_is_blocked`,
   * `transaction_not_found`, and declines such as `insufficient_funds`.
   *
   * @example
   * await paylov.payments.confirmPanPayment({
   *   transactionId: started.transactionId,
   *   otp: otpFromUser,
   * });
   */
  confirmPanPayment(
    params: ConfirmPanPaymentParams,
    options?: PaylovCallOptions,
  ): Promise<TransactionReference>;
}

export function createPaymentsResource(http: HttpClient): PaymentsResource {
  return {
    async create(params, options) {
      const method = 'payments.create';
      const { input, signal } = readCall(params, options, method);
      const body = {
        amount: input.tiyinAsWholeSum('amountTiyin'),
        // The gateway requires the key.
        account: input.optionalJson('account') ?? {},
        userId: input.optionalString('userId'),
      };
      return send(http, ENDPOINTS.create, { body, signal }, decodeTransactionReference);
    },

    async pay(params, options) {
      const method = 'payments.pay';
      const { input, signal } = readCall(params, options, method);
      const body = {
        transactionId: input.string('transactionId'),
        cardId: input.string('cardId'),
        userId: input.string('userId'),
      };
      return send(http, ENDPOINTS.pay, { body, signal }, decodeTransactionReference);
    },

    async refund(params, options) {
      const method = 'payments.refund';
      const { input, signal } = readCall(params, options, method);
      const body = { transactionId: input.string('transactionId') };
      return send(http, ENDPOINTS.refund, { body, signal }, decodePaymentRefunded);
    },

    async startPanPayment(params, options) {
      const method = 'payments.startPanPayment';
      const { input, signal } = readCall(params, options, method);
      // `extId` is never sent: the gateway echoes it but does not store it, so it cannot be
      // looked up afterwards.
      const body = {
        cardNumber: input.string('cardNumber'),
        expireDate: input.string('cardExpiry'),
        amount: input.tiyinAsWholeSum('amountTiyin'),
        // The gateway requires the key.
        account: input.optionalJson('account') ?? {},
      };
      return send(http, ENDPOINTS.startPanPayment, { body, signal }, decodePanPaymentStarted);
    },

    async confirmPanPayment(params, options) {
      const method = 'payments.confirmPanPayment';
      const { input, signal } = readCall(params, options, method);
      const body = {
        transactionId: input.string('transactionId'),
        otp: input.string('otp'),
      };
      return send(http, ENDPOINTS.confirmPanPayment, { body, signal }, decodeTransactionReference);
    },
  };
}
