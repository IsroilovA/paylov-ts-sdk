import { orOnMiss, readCall, send } from '../core/call.js';
import { everyLiteral } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { readReceiptItem } from '../shared/receiptItems.js';
import { readTransactionLookup } from '../shared/transactions.js';
import {
  decodeActivityTypeCheck,
  decodeAttachConfirmation,
  decodeReceiptLookup,
  decodeReceiptRefunded,
  decodeFiscalReceiptRegistered,
} from './decoders.js';
import type {
  ActivityTypeCheck,
  AttachFiscalReceiptParams,
  CheckActivityTypeParams,
  FiscalActivityType,
  FiscalReceipt,
  FiscalReceiptRegistered,
  FiscalReceiptRefunded,
  GetFiscalReceiptParams,
  RefundFiscalReceiptParams,
  RegisterFiscalReceiptParams,
} from './types.js';

export const ENDPOINTS = {
  registerReceipt: {
    method: 'POST',
    route: '/merchant/fiscalization/register/',
    shape: 'envelope',
  },
  getReceipt: {
    method: 'GET',
    route: '/merchant/fiscalization/status/',
    shape: 'envelope',
    // Paylov answers it only for an unknown `externalId`; an unknown `transactionId` is
    // `transaction_not_found`.
    miss: 'ofd_check_not_found',
  },
  attachReceipt: {
    method: 'POST',
    route: '/merchant/fiscalization/set-receipt/',
    shape: 'envelope',
  },
  refundReceipt: { method: 'POST', route: '/merchant/fiscalization/refund/', shape: 'envelope' },
  checkActivityType: {
    method: 'POST',
    route: '/merchant/fiscalization/activity-types/',
    shape: 'envelope',
  },
} as const;

export const ACTIVITY_TYPES: readonly FiscalActivityType[] = everyLiteral<FiscalActivityType>()([
  'individual_entrepreneur',
  'self_employed',
  'high_income',
]);

export const WIRE_ACTIVITY_TYPES: Readonly<Record<FiscalActivityType, number>> = {
  individual_entrepreneur: 1,
  self_employed: 2,
  high_income: 3,
};

/**
 * The `paylov.fiscalization` namespace: OFD fiscal receipts and tax-service activity checks.
 * Every method except `getReceipt` needs fiscalization enabled for the merchant; otherwise it
 * fails with `permission_denied`.
 */
export interface FiscalizationResource {
  /**
   * Has Paylov register a fiscal receipt with the OFD: for a paid card payment by
   * `transactionId`, or for a cash sale by `externalId` and `phoneNumber`. Moves no money. Item
   * prices are integer tiyin; their total must equal the transaction amount.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `getReceipt` before registering again;
   * `null` means nothing is registered yet. `ofd_check_already_generated` on a repeated call
   * means a receipt exists.
   *
   * @throws {@link PaylovApiError} `ofd_check_already_generated`,
   *   `receipt_not_available_for_operation` (not paid), `invalid_amount` (item total),
   *   `ofd_commitent_or_subcommission_not_active` (an item's TIN or PINFL has no active OFD
   *   contract), `ofd_error`, `fiscal_receipt_not_generated`, `permission_denied`.
   *
   * @example
   * const receipt = await paylov.fiscalization.registerReceipt({
   *   transactionId,
   *   items: [
   *     {
   *       title: 'Consultation',
   *       priceTiyin: 25_000_000,
   *       count: 1,
   *       code: ikpuCode,
   *       vatPercent: 12,
   *       packageCode,
   *       tin: commitentTin,
   *     },
   *   ],
   * });
   * await receipts.save(transactionId, receipt.receiptId, receipt.receiptUrl);
   */
  registerReceipt(
    params: RegisterFiscalReceiptParams,
    options?: PaylovCallOptions,
  ): Promise<FiscalReceiptRegistered>;

  /**
   * Reads the receipt of a card payment by `transactionId`, or of a cash sale by the `externalId`
   * it was registered with. Resolves `null` when no receipt is found for the transaction or the
   * `externalId`; the OFD may register one later, so `null` is an observation, not proof. Moves
   * no money and works without fiscalization enabled.
   *
   * @throws {@link PaylovApiError} `transaction_not_found` for an unknown `transactionId`.
   *
   * @example
   * const receipt = await paylov.fiscalization.getReceipt({ transactionId, isRefund: false });
   * if (receipt !== null) await receipts.save(transactionId, receipt.receiptId, receipt.receiptUrl);
   */
  getReceipt(
    params: GetFiscalReceiptParams,
    options?: PaylovCallOptions,
  ): Promise<FiscalReceipt | null>;

  /**
   * Attaches a receipt you fiscalized yourself to a paid Paylov transaction; nothing is sent to
   * the OFD. Moves no money. Needs fiscalization in client-side mode, otherwise
   * `permission_denied`.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `getReceipt` before attaching again;
   * `ofd_check_already_generated` on a repeated call means a receipt is attached.
   *
   * @throws {@link PaylovApiError} `ofd_check_already_generated`, `field_not_valid` (`fields`
   *   names the wire field `transactionId`, `dateTime` for `issuedAtRaw`, or `qrCodeUrl` for
   *   `receiptUrl`), `external_id_already_exists`,
   *   `transaction_not_found`, `receipt_not_available_for_operation`,
   *   `ofd_too_many_requests_for_this_receipt`, `permission_denied`.
   *
   * @example
   * await paylov.fiscalization.attachReceipt({
   *   transactionId,
   *   terminalId: ofdReceipt.terminalId,
   *   issuedAtRaw: '20260915143025',
   *   fiscalSign: ofdReceipt.fiscalSign,
   *   receiptUrl: ofdReceipt.receiptUrl,
   *   receiptId: ofdReceipt.receiptId,
   * });
   */
  attachReceipt(params: AttachFiscalReceiptParams, options?: PaylovCallOptions): Promise<void>;

  /**
   * Registers an OFD refund receipt that reverses a sale receipt. Moves no money: refund a card
   * payment with `payments.refund`, which Paylov documents also cancels its fiscalization. For a
   * card payment, call this only when `getReceipt({ transactionId, isRefund: true })` shows no
   * refund receipt after `payments.refund`.
   *
   * Recovery: store each `receiptId` with its `transactionId` or `externalId`; when
   * `isPaylovOutcomeUnknown(error)`, read `getReceipt({ ..., isRefund: true })` before refunding
   * again.
   *
   * @throws {@link PaylovApiError} `ofd_check_not_found`, `ofd_error`, `permission_denied`.
   *
   * @example
   * const { refund } = await paylov.fiscalization.refundReceipt({ receiptId: sale.receiptId });
   * await receipts.saveRefund(sale.externalId, refund.receiptId, refund.receiptUrl);
   */
  refundReceipt(
    params: RefundFiscalReceiptParams,
    options?: PaylovCallOptions,
  ): Promise<FiscalReceiptRefunded>;

  /**
   * Asks the tax service whether a person has an activity type, before fiscalizing on their
   * behalf. Moves no money. A negative answer may arrive as `PaylovApiError`
   * `gateway_not_working` instead of `isConfirmed: false`; treat that as unconfirmed.
   *
   * @throws {@link PaylovApiError} `gateway_not_working`, `permission_denied`.
   *
   * @example
   * const check = await paylov.fiscalization.checkActivityType({
   *   pinfl: sellerPinfl,
   *   activityType: 'self_employed',
   * });
   * if (!check.isConfirmed) await sellers.flagForReview(sellerId);
   */
  checkActivityType(
    params: CheckActivityTypeParams,
    options?: PaylovCallOptions,
  ): Promise<ActivityTypeCheck>;
}

export function createFiscalizationResource(http: HttpClient): FiscalizationResource {
  return {
    async registerReceipt(params, options) {
      const method = 'fiscalization.registerReceipt';
      const { input, signal } = readCall(params, options, method);
      const lookup = readTransactionLookup(input);
      const sale =
        lookup.transactionId === undefined
          ? { ...lookup, phoneNumber: input.string('phoneNumber') }
          : lookup;
      const body = { ...sale, items: input.array('items', readReceiptItem) };
      return send(http, ENDPOINTS.registerReceipt, { body, signal }, decodeFiscalReceiptRegistered);
    },

    async getReceipt(params, options) {
      const method = 'fiscalization.getReceipt';
      const { input, signal } = readCall(params, options, method);
      const query = {
        ...readTransactionLookup(input),
        refunded: input.optionalBoolean('isRefund'),
      };
      const receipt = send(http, ENDPOINTS.getReceipt, { query, signal }, decodeReceiptLookup);
      return orOnMiss(receipt, ENDPOINTS.getReceipt, null);
    },

    async attachReceipt(params, options) {
      const method = 'fiscalization.attachReceipt';
      const { input, signal } = readCall(params, options, method);
      const body = {
        transactionId: input.string('transactionId'),
        externalId: input.optionalString('externalId'),
        terminalId: input.string('terminalId'),
        dateTime: input.string('issuedAtRaw'),
        fiscalSign: input.string('fiscalSign'),
        qrCodeUrl: input.string('receiptUrl'),
        receiptId: input.integer('receiptId'),
      };
      return send(http, ENDPOINTS.attachReceipt, { body, signal }, decodeAttachConfirmation);
    },

    async refundReceipt(params, options) {
      const method = 'fiscalization.refundReceipt';
      const { input, signal } = readCall(params, options, method);
      const body = { receiptId: input.integer('receiptId') };
      return send(http, ENDPOINTS.refundReceipt, { body, signal }, decodeReceiptRefunded);
    },

    async checkActivityType(params, options) {
      const method = 'fiscalization.checkActivityType';
      const { input, signal } = readCall(params, options, method);
      const body = {
        pinfl: input.string('pinfl'),
        activityType: WIRE_ACTIVITY_TYPES[input.literal('activityType', ACTIVITY_TYPES)],
      };
      return send(http, ENDPOINTS.checkActivityType, { body, signal }, decodeActivityTypeCheck);
    },
  };
}
