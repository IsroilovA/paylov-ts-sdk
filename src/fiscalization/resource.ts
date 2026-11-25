import { readCall, send } from '../core/call.js';
import { everyLiteral } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import type { FiscalReceipt, FiscalReceiptRegistered } from '../shared/fiscalReceipts.js';
import { readReceiptItem } from '../shared/receiptItems.js';
import {
  decodeActivityTypeCheck,
  decodeReceiptLookup,
  decodeReceiptRefunded,
  decodeFiscalReceiptRegistered,
} from './decoders.js';
import type {
  ActivityTypeCheck,
  CheckActivityTypeParams,
  FiscalActivityType,
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
   * Has Paylov register a fiscal receipt with the OFD for a paid card payment. Moves no money. Item
   * prices are integer tiyin; the lines, each `(priceTiyin - discountTiyin) * count`, must total
   * the transaction amount.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `getReceipt` before registering again;
   * `null` means nothing is registered yet. `ofd_check_already_generated` on a repeated call
   * means a receipt exists. After `ofd_error` from the OFD rejecting an item, such as a
   * `packageCode` that does not belong to the item's `code`, nothing is registered: fix the item
   * and register again.
   *
   * @throws {@link PaylovApiError} `ofd_check_already_generated`, `transaction_not_found`,
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
   * Reads the receipt of a card payment. Resolves `null` when the transaction has no receipt; the
   * OFD may register one later, so `null` is an observation, not proof. Moves no money and works
   * without fiscalization enabled.
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
   * Registers an OFD refund receipt that reverses a sale receipt. Moves no money: refund a card
   * payment with `payments.refund`, after which Paylov registers its refund receipt within seconds
   * to minutes. For a card payment, call this only when `getReceipt({ transactionId, isRefund:
   * true })` still shows no refund receipt some minutes after `payments.refund`.
   *
   * Recovery: store each `receiptId` with its `transactionId`; when
   * `isPaylovOutcomeUnknown(error)`, read `getReceipt({ transactionId, isRefund: true })` before
   * refunding again. `ofd_check_already_generated` means a refund receipt exists.
   *
   * @throws {@link PaylovApiError} `ofd_check_already_generated` (a refund receipt exists),
   *   `receipt_not_available_for_operation` (a card payment that is not refunded), `ofd_check_not_found`
   *   (unknown `receiptId`), `permission_denied` (fiscalization not enabled).
   *
   * @example
   * const { refund } = await paylov.fiscalization.refundReceipt({ receiptId: sale.receiptId });
   * await receipts.saveRefund(transactionId, refund.receiptId, refund.receiptUrl);
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
      const body = {
        transactionId: input.string('transactionId'),
        items: input.array('items', readReceiptItem),
      };
      return send(http, ENDPOINTS.registerReceipt, { body, signal }, decodeFiscalReceiptRegistered);
    },

    async getReceipt(params, options) {
      const method = 'fiscalization.getReceipt';
      const { input, signal } = readCall(params, options, method);
      const query = {
        transactionId: input.string('transactionId'),
        refunded: input.optionalBoolean('isRefund'),
      };
      return send(http, ENDPOINTS.getReceipt, { query, signal }, decodeReceiptLookup);
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
