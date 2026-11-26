import { readCall, send } from '../core/call.js';
import { invalidInput } from '../core/errors.js';
import type { Params } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { readReceiptItem, type WireReceiptItem } from '../shared/receiptItems.js';
import { decodeTransactionReference, type TransactionReference } from '../shared/transactions.js';
import { decodeSplit, decodeSplitReceiptResent } from './decoders.js';
import type {
  CreateSplitParams,
  GetSplitParams,
  ResendSplitReceiptParams,
  Split,
  SplitReceiptResent,
} from './types.js';

export const ENDPOINTS = {
  create: { method: 'POST', route: '/merchant/splitPayment/', shape: 'envelope', effect: 'money' },
  resendReceipt: {
    method: 'POST',
    route: '/merchant/splitPayment/',
    shape: 'envelope',
    effect: 'write',
  },
  get: {
    method: 'GET',
    route: '/merchant/splitPayment/status/',
    shape: 'envelope',
    effect: 'read',
  },
} as const;

/**
 * The `paylov.splits` namespace: divides a paid transaction among recipients. Every method needs
 * split payments enabled for the merchant; otherwise they fail with `permission_denied`.
 */
export interface SplitsResource {
  /**
   * Splits a paid transaction: each recipient receives a sub-transaction with its amount. Moves
   * money to the recipients. Recipient amounts are integer tiyin and must add up to the
   * transaction amount. A recipient's `items` are registered with the OFD in the background; read
   * the result with `splits.get`.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `splits.get` before splitting again: its
   * shares mean the split exists. `split_not_found` right after the failure proves nothing: read
   * again after a backoff before splitting again with the same recipients. `split_already_done` on
   * a repeated call means the split exists.
   *
   * @throws {@link PaylovInputError} `sdk_invalid_input` for an item without exactly one of `tin`
   * or `pinfl`, before anything is sent.
   * @throws {@link PaylovApiError} `split_already_done`, `invalid_amount` (amounts do not add up),
   * `recipient_not_found`, `receipt_not_available_for_split` (the transaction is not paid),
   * `transaction_not_found`, `ofd_commitent_or_subcommission_not_active` (an item's `tin` or
   * `pinfl` has no active OFD contract), `permission_denied`.
   *
   * @example
   * await paylov.splits.create({
   *   transactionId,
   *   recipients: [
   *     { recipientId: platformRecipientId, amountTiyin: 150_000 },
   *     { recipientId: sellerRecipientId, amountTiyin: 850_000 },
   *   ],
   * });
   */
  create(params: CreateSplitParams, options?: PaylovCallOptions): Promise<TransactionReference>;

  /**
   * Submits a split's receipt lines to the OFD again, after its receipt was not registered, such
   * as for an item the tax classifier rejected. Splits nothing and moves no money; the receipt
   * appears in `splits.get` seconds later. Paylov does not say whether a resend while the first
   * submission is still pending registers twice, so resend only once `splits.get` has shown no
   * receipt for a while.
   *
   * Send every recipient of the split with its amount, and the receipt lines on the recipients
   * whose share carries them: a recipient without items is allowed, but at least one recipient
   * must carry items, since Paylov answers a resend without any with `field_required`.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `splits.get`. A receipt there shows that
   * a receipt exists, not which submission registered it: the original one or a later refund can
   * produce it too, and its `isRefund` tells a refund receipt from a sale receipt.
   * `ofd_check_already_generated` on a repeated call means a receipt exists.
   *
   * @throws {@link PaylovInputError} `sdk_invalid_input` when no recipient carries `items`, or for an
   * item without exactly one of `tin` or `pinfl`, before anything is sent.
   * @throws {@link PaylovApiError} `ofd_check_already_generated` (the split has a receipt),
   * `split_not_found` (the transaction has no split), `permission_denied`.
   *
   * @example
   * const { status } = await paylov.splits.resendReceipt({
   *   transactionId,
   *   recipients: [
   *     { recipientId: platformRecipientId, amountTiyin: 150_000 },
   *     { recipientId: sellerRecipientId, amountTiyin: 850_000, items: correctedSellerItems },
   *   ],
   * });
   */
  resendReceipt(
    params: ResendSplitReceiptParams,
    options?: PaylovCallOptions,
  ): Promise<SplitReceiptResent>;

  /**
   * Reads a split transaction: every recipient's share and the split's fiscal receipt. Moves no
   * money.
   *
   * @throws {@link PaylovApiError} `split_not_found` (the transaction has no split),
   * `transaction_not_found` (no such transaction), `permission_denied`.
   *
   * @example
   * const split = await paylov.splits.get({ transactionId });
   * const unpaid = split.shares.filter((share) => share.status !== 'paid');
   */
  get(params: GetSplitParams, options?: PaylovCallOptions): Promise<Split>;
}

interface WireSplitRecipient {
  readonly recipientId: string;
  /** Tiyin. */
  readonly amount: number;
  readonly items: readonly WireReceiptItem[] | undefined;
}

function readRecipient(recipient: Params): WireSplitRecipient {
  return {
    recipientId: recipient.string('recipientId'),
    amount: recipient.tiyin('amountTiyin'),
    items: recipient.optionalArray('items', readReceiptItem),
  };
}

function hasItems(recipient: WireSplitRecipient): boolean {
  return recipient.items !== undefined && recipient.items.length > 0;
}

export function createSplitsResource(http: HttpClient): SplitsResource {
  return {
    async create(params, options) {
      const method = 'splits.create';
      const { input, signal } = readCall(params, options, method);
      const body = {
        transactionId: input.string('transactionId'),
        recipients: input.array('recipients', readRecipient),
      };
      return send(http, ENDPOINTS.create, { body, signal }, decodeTransactionReference);
    },

    async resendReceipt(params, options) {
      const method = 'splits.resendReceipt';
      const { input, signal } = readCall(params, options, method);
      const transactionId = input.string('transactionId');
      const recipients = input.array('recipients', readRecipient);
      // A resend without items answers `field_required` (docs/paylov/splits.md#resend-to-the-ofd).
      if (!recipients.some(hasItems)) {
        throw invalidInput(
          `${method}: recipients must carry items on at least one recipient`,
          'recipients',
          'required',
        );
      }
      const body = { transactionId, recipients, resendOFD: true };
      return send(http, ENDPOINTS.resendReceipt, { body, signal }, decodeSplitReceiptResent);
    },

    async get(params, options) {
      const method = 'splits.get';
      const { input, signal } = readCall(params, options, method);
      const query = { transactionId: input.string('transactionId') };
      return send(http, ENDPOINTS.get, { query, signal }, decodeSplit);
    },
  };
}
