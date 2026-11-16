import { readCall, send } from '../core/call.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { decodeRequestedTransaction, decodeRrn, decodeTransactionPage } from './decoders.js';
import type {
  GetRrnParams,
  GetTransactionParams,
  ListTransactionsParams,
  Transaction,
  TransactionPage,
} from './types.js';

export const ENDPOINTS = {
  getTransactions: { method: 'GET', route: '/merchant/getTransactions/', shape: 'envelope' },
  getRrn: {
    method: 'GET',
    route: '/merchant/getTransactions/rrn/{transactionId}/',
    shape: 'envelope',
  },
} as const;

/** The `paylov.transactions` namespace. */
export interface TransactionsResource {
  /**
   * Reads one transaction in any status: a receipt, PAN, hold or checkout payment. This is the
   * read to reconcile with after an ambiguous failure of a money-moving call.
   *
   * Resolves to `null` when the gateway knows no such transaction. A miss right after a failed
   * call is an observation, not proof that nothing was created: read again after a delay.
   *
   * @example
   * const transaction = await paylov.transactions.get({ transactionId });
   * if (transaction === null) {
   *   // unknown to the gateway (so far)
   * } else if (transaction.status === 'paid') {
   *   await orders.markPaid(orderId, transaction.paidOrCreatedAt);
   * } else if (transaction.status === 'failed') {
   *   await orders.markDeclined(orderId, transaction.declineCode);
   * }
   */
  get(params: GetTransactionParams, options?: PaylovCallOptions): Promise<Transaction | null>;

  /**
   * Lists the merchant's **paid** transactions, newest payment first, one page at a time.
   *
   * Created, held, failed and refunded transactions are not listed, so a refunded
   * payment drops out: this is a settled-sales feed, not an audit log, and never a way to
   * reconcile. The list is merchant-wide (no user filter). Paylov does not document the page size
   * (20 on its test environment): page until `transactions` is empty or the rows seen reach
   * `total`.
   *
   * @throws {@link PaylovApiError} `field_not_valid` (a date the gateway rejects).
   *
   * @example
   * const seen: Transaction[] = [];
   * for (let page = 1; ; page += 1) {
   *   const result = await paylov.transactions.list({
   *     fromDate: '2026-11-01',
   *     toDate: '2026-11-30',
   *     page,
   *   });
   *   seen.push(...result.transactions);
   *   if (result.transactions.length === 0 || seen.length >= result.total) break;
   * }
   */
  list(params?: ListTransactionsParams, options?: PaylovCallOptions): Promise<TransactionPage>;

  /**
   * Reads the card network's retrieval reference number (RRN) of a paid transaction, for
   * disputes and bank-side lookups. Known to work for `payments.pay` payments, also after a
   * refund. PAN payments have none (`transaction_not_available_for_payment`); whether captured
   * holds and checkout payments have one is undocumented.
   *
   * @throws {@link PaylovApiError} `transaction_not_found`, `receipt_not_available_for_operation`
   * (not paid), `transaction_not_available_for_payment` (a payment type without an RRN).
   *
   * @example
   * const rrn = await paylov.transactions.getRrn({ transactionId });
   */
  getRrn(params: GetRrnParams, options?: PaylovCallOptions): Promise<string>;
}

export function createTransactionsResource(http: HttpClient): TransactionsResource {
  return {
    async get(params, options) {
      const method = 'transactions.get';
      const { input, signal } = readCall(params, options, method);
      const transactionId = input.string('transactionId');
      return send(
        http,
        ENDPOINTS.getTransactions,
        { query: { id: transactionId }, signal },
        decodeRequestedTransaction(transactionId),
      );
    },

    async list(params, options) {
      const method = 'transactions.list';
      const { input, signal } = readCall(params ?? {}, options, method);
      const query = {
        beginDate: input.optionalString('fromDate'),
        endDate: input.optionalString('toDate'),
        page: input.optionalInteger('page'),
      };
      return send(http, ENDPOINTS.getTransactions, { query, signal }, decodeTransactionPage);
    },

    async getRrn(params, options) {
      const method = 'transactions.getRrn';
      const { input, signal } = readCall(params, options, method);
      const transactionId = input.string('transactionId');
      return send(http, ENDPOINTS.getRrn, { path: { transactionId }, signal }, decodeRrn);
    },
  };
}
