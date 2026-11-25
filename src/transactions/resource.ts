import { readCall, send } from '../core/call.js';
import { responseContext } from '../core/endpoint.js';
import { malformedResponse, type PaylovProtocolError } from '../core/errors.js';
import type { Params } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { decodeRequestedTransaction, decodeRrn, decodeTransactionPage } from './decoders.js';
import type {
  GetRrnParams,
  GetTransactionParams,
  IterateTransactionsParams,
  ListTransactionsParams,
  Transaction,
  TransactionPage,
} from './types.js';

export const ENDPOINTS = {
  getTransactions: {
    method: 'GET',
    route: '/merchant/getTransactions/',
    shape: 'envelope',
    effect: 'read',
  },
  getRrn: {
    method: 'GET',
    route: '/merchant/getTransactions/rrn/{transactionId}/',
    shape: 'envelope',
    effect: 'read',
  },
} as const;

/** The `paylov.transactions` namespace. */
export interface TransactionsResource {
  /**
   * Reads one of the merchant's transactions in any status, whatever created it: SDK payments and
   * holds, and payments made elsewhere, such as through Paylov's hosted checkout. Moves no money.
   * This is the read to reconcile with after an ambiguous `payments.pay`,
   * `payments.confirmPanPayment` or `payments.refund`. An ambiguous `holds.create` leaves only its
   * `externalId`, read with `holds.get`, as are a hold's capture and release; a split is read with
   * `splits.get`, which carries the recipient shares.
   *
   * @throws {@link PaylovApiError} `transaction_not_found` when the gateway knows no such
   * transaction. Paylov answers that with an empty list, so the SDK synthesizes the error, with
   * the answer's HTTP status; it is definitive. Right after an ambiguous call it
   * is not proof that nothing was created: read again after a delay.
   *
   * @example
   * const transaction = await paylov.transactions.get({ transactionId });
   * if (transaction.status === 'paid') {
   *   await orders.markPaid(orderId, transaction.paidOrCreatedAt);
   * } else if (transaction.status === 'failed') {
   *   await orders.markDeclined(orderId, transaction.declineCode);
   * }
   */
  get(params: GetTransactionParams, options?: PaylovCallOptions): Promise<Transaction>;

  /**
   * Lists the merchant's **paid** transactions in the gateway's order, one page at a time. Moves no
   * money. The order is roughly newest payment first but not strictly: sort the rows where order
   * matters.
   *
   * Created, held, failed and refunded transactions are not listed, so a refunded
   * payment drops out: this is a settled-sales feed, not an audit log, and never a way to
   * reconcile. The list is merchant-wide (no user filter), and the dates are Tashkent calendar
   * days. Paylov does not document the page size (20 on its test environment);
   * {@link TransactionsResource.iterate} pages through a range for you.
   *
   * @throws {@link PaylovApiError} `field_not_valid` (a date the gateway rejects).
   *
   * @example
   * const firstPage = await paylov.transactions.list({ fromDate: '2026-11-01', toDate: '2026-11-30' });
   * metrics.gauge('paylov.paid_transactions', firstPage.total);
   */
  list(params?: ListTransactionsParams, options?: PaylovCallOptions): Promise<TransactionPage>;

  /**
   * Every transaction `transactions.list` reports for the range, fetched page by page as the
   * loop consumes it. Moves no money. The same feed: **paid** transactions only, in the
   * gateway's order, with `fromDate` and `toDate` as Tashkent (UTC+5) calendar days. Paging stops once the
   * transactions seen reach the reported `total`, or at an empty page. A transaction pushed to a
   * later page by a payment made while the loop runs is yielded once; a refund made meanwhile can
   * move an unseen one to an earlier page and out of reach, so this is not a snapshot.
   *
   * Parameters are checked when it is called, each page is requested when the loop needs it, and
   * `signal` aborts the next request.
   *
   * @throws {@link PaylovApiError} `field_not_valid` (a date the gateway rejects).
   * @throws {@link PaylovProtocolError} `sdk_malformed_response` when two pages in a row bring no
   * new transaction: a guard against a gateway that ignores `page`, which also trips when payments
   * made meanwhile push already-seen transactions onto two successive pages.
   *
   * @example
   * for await (const transaction of paylov.transactions.iterate({
   *   fromDate: '2026-11-01',
   *   toDate: '2026-11-30',
   * })) {
   *   await settlements.record(transaction.transactionId, transaction.amountTiyin);
   * }
   */
  iterate(
    params?: IterateTransactionsParams,
    options?: PaylovCallOptions,
  ): AsyncIterable<Transaction>;

  /**
   * Reads the card network's retrieval reference number (RRN) of a paid transaction, for
   * disputes and bank-side lookups. Moves no money. Known to work for `payments.pay` payments,
   * also after a refund, and for holds, already before capture. PAN payments have none
   * (`transaction_not_available_for_payment`).
   *
   * @throws {@link PaylovApiError} `transaction_not_found`, `receipt_not_available_for_operation`
   * (not paid), `transaction_not_available_for_payment` (a payment type without an RRN).
   *
   * @example
   * const rrn = await paylov.transactions.getRrn({ transactionId });
   */
  getRrn(params: GetRrnParams, options?: PaylovCallOptions): Promise<string>;
}

/**
 * Yields each transaction once, page after page. New payments push seen rows to later pages, so a
 * seen row is skipped. A full page of new payments makes one page all seen, so only a second such
 * page in a row means the gateway ignored `page`.
 *
 * @yields Each transaction of the range, in the gateway's page order.
 */
/** The rows of `transactions` not yet in `seen`, each once, recorded in `seen` as they are taken. */
function takeUnseen(transactions: readonly Transaction[], seen: Set<string>): Transaction[] {
  const unseen: Transaction[] = [];
  for (const transaction of transactions) {
    if (seen.has(transaction.transactionId)) continue;
    seen.add(transaction.transactionId);
    unseen.push(transaction);
  }
  return unseen;
}

async function* iteratePages(
  fetchPage: (page: number) => Promise<TransactionPage>,
): AsyncGenerator<Transaction, void, undefined> {
  const seen = new Set<string>();
  let stalledPages = 0;
  for (let page = 1; ; page += 1) {
    const { total, transactions } = await fetchPage(page);
    if (transactions.length === 0) return;
    const fresh = takeUnseen(transactions, seen);
    stalledPages = fresh.length === 0 ? stalledPages + 1 : 0;
    if (stalledPages > 1) throw stalledPage();
    yield* fresh;
    if (seen.size >= total) return;
  }
}

function readRange(input: Params): {
  beginDate: string | undefined;
  endDate: string | undefined;
} {
  return {
    beginDate: input.optionalString('fromDate'),
    endDate: input.optionalString('toDate'),
  };
}

function stalledPage(): PaylovProtocolError {
  return malformedResponse(responseContext(ENDPOINTS.getTransactions, 200), 'result.transactions');
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
      const query = { ...readRange(input), page: input.optionalInteger('page') };
      return send(http, ENDPOINTS.getTransactions, { query, signal }, decodeTransactionPage);
    },

    iterate(params, options) {
      const method = 'transactions.iterate';
      const { input, signal } = readCall(params ?? {}, options, method);
      const range = readRange(input);
      return iteratePages((page) =>
        send(
          http,
          ENDPOINTS.getTransactions,
          { query: { ...range, page }, signal },
          decodeTransactionPage,
        ),
      );
    },

    async getRrn(params, options) {
      const method = 'transactions.getRrn';
      const { input, signal } = readCall(params, options, method);
      const transactionId = input.string('transactionId');
      return send(http, ENDPOINTS.getRrn, { path: { transactionId }, signal }, decodeRrn);
    },
  };
}
