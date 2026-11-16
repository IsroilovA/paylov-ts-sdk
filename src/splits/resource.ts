import { readCall, send } from '../core/call.js';
import type { Params } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { readReceiptItem, type WireReceiptItem } from '../shared/receiptItems.js';
import { decodeTransactionReference, type TransactionReference } from '../shared/transactions.js';
import { decodeSplitShares } from './decoders.js';
import type { CreateSplitParams, GetSplitParams, SplitShare } from './types.js';

export const ENDPOINTS = {
  create: { method: 'POST', route: '/merchant/splitPayment/', shape: 'envelope' },
  get: { method: 'GET', route: '/merchant/splitPayment/status/', shape: 'envelope' },
} as const;

/**
 * The `paylov.splits` namespace: divides a paid transaction among recipients. Both methods need
 * split payments enabled for the merchant; otherwise they fail with `permission_denied`.
 */
export interface SplitsResource {
  /**
   * Splits a paid transaction: each recipient receives a sub-transaction with its amount. Moves
   * money to the recipients. Amounts are integer tiyin and must add up to the transaction amount.
   * A recipient's `items` start OFD fiscalization of its share in the background.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `splits.get` before splitting again;
   * `split_already_done` on a repeated call means the split exists.
   *
   * @throws {@link PaylovApiError} `split_already_done`, `transaction_not_found`,
   * `invalid_amount` (amounts do not add up), `recipient_not_found`,
   * `ofd_commitent_or_subcommission_not_active`, `permission_denied`.
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
   * Reads every recipient's share of a split transaction. Moves no money.
   *
   * Unlike `holds.get`, a miss throws instead of returning `null`: Paylov documents
   * `split_not_found` for a transaction without a split, but that code has not been observed.
   *
   * @throws {@link PaylovApiError} `split_not_found`, `transaction_not_found`,
   * `permission_denied`.
   *
   * @example
   * const shares = await paylov.splits.get({ transactionId });
   * const unpaid = shares.filter((share) => share.status !== 'paid');
   */
  get(params: GetSplitParams, options?: PaylovCallOptions): Promise<readonly SplitShare[]>;
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

export function createSplitsResource(http: HttpClient): SplitsResource {
  return {
    async create(params, options) {
      const method = 'splits.create';
      const { input, signal } = readCall(params, options, method);
      const body = {
        transactionId: input.string('transactionId'),
        recipients: input.array('recipients', readRecipient),
        // When a resend is needed is undocumented ([OPEN Q59]); the flag is forwarded as given.
        resendOFD: input.optionalBoolean('resendOfd'),
      };
      return send(http, ENDPOINTS.create, { body, signal }, decodeTransactionReference);
    },

    async get(params, options) {
      const method = 'splits.get';
      const { input, signal } = readCall(params, options, method);
      const query = { transactionId: input.string('transactionId') };
      return send(http, ENDPOINTS.get, { query, signal }, decodeSplitShares);
    },
  };
}
