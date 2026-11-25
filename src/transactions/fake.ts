import {
  nullableOf,
  optionalEntry,
  tashkentDateTimeOf,
  utcDateTimeOf,
  type FakeRequest,
  type FakeSpecTable,
} from '../core/fake.js';
import { encodeStatus } from '../shared/fake.js';
import { TRANSACTION_STATUS_BY_WIRE } from './decoders.js';
import { ENDPOINTS, type TransactionsResource } from './resource.js';
import type {
  FiscalReceiptSummary,
  GetRrnParams,
  GetTransactionParams,
  ListTransactionsParams,
  Transaction,
  TransactionPage,
} from './types.js';

function encodeFiscalReceiptSummary(receipt: FiscalReceiptSummary): unknown {
  return {
    receipt_id: receipt.receiptId,
    qr_code_url: receipt.receiptUrl,
    date_time: utcDateTimeOf(receipt.issuedAt, 'issuedAt'),
    is_refund: receipt.isRefund,
  };
}

/** Wire spellings the simulation chose for transactions it built; a scripted reply has none. */
const WIRE_STATUSES = new WeakMap<Transaction, string>();

/**
 * Marks `transaction` to encode its status as `wireStatus`, one of the spellings the SDK reads as
 * that status, where Paylov's spelling records how the state was reached (a hold dismissed reads
 * `cancel`, one released after an expired capture `refunded`). Returns `transaction`.
 */
export function withWireStatus(transaction: Transaction, wireStatus: string): Transaction {
  if (TRANSACTION_STATUS_BY_WIRE.get(wireStatus) !== transaction.status) {
    throw new TypeError(`wire status ${wireStatus} does not read as ${transaction.status}`);
  }
  WIRE_STATUSES.set(transaction, wireStatus);
  return transaction;
}

function encodeTransaction(transaction: Transaction): unknown {
  return {
    id: transaction.transactionId,
    external_id: transaction.externalId,
    userId: transaction.userId,
    card_id: transaction.cardId,
    cardNumber: transaction.maskedCardNumber,
    amount_in_tiyin: transaction.amountTiyin,
    status:
      WIRE_STATUSES.get(transaction) ??
      encodeStatus(TRANSACTION_STATUS_BY_WIRE, transaction.status),
    account: {},
    error_message: transaction.declineCode,
    date: tashkentDateTimeOf(transaction.paidOrCreatedAt, 'paidOrCreatedAt'),
    cancel_time: nullableOf(transaction.cancelledAt, (date) =>
      tashkentDateTimeOf(date, 'cancelledAt'),
    ),
    is_hold: transaction.isHold,
    is_split: transaction.isSplit,
    is_a2c: transaction.isA2c,
    ofd: transaction.fiscalReceipts.map(encodeFiscalReceiptSummary),
  };
}

function encodeRequestedTransaction(transaction: Transaction): unknown {
  return { transactions: [encodeTransaction(transaction)] };
}

function encodeTransactionPage(page: TransactionPage): unknown {
  return {
    totalTransaction: page.total,
    transactions: page.transactions.map(encodeTransaction),
  };
}

function encodeRrn(rrn: string): unknown {
  return { rrn };
}

/** `get` and `list` share the endpoint; only `get` sends an `id`. */
function isSingleRead({ query }: FakeRequest): boolean {
  return query.raw('id') !== undefined;
}

function decodeGetRequest({ query }: FakeRequest): GetTransactionParams {
  return { transactionId: query.string('id') };
}

function decodeListRequest({ query }: FakeRequest): ListTransactionsParams {
  const page = query.optionalString('page');
  return {
    ...optionalEntry('fromDate', query.optionalString('beginDate')),
    ...optionalEntry('toDate', query.optionalString('endDate')),
    ...optionalEntry('page', page === undefined ? undefined : Number(page)),
  };
}

function decodeGetRrnRequest({ path }: FakeRequest): GetRrnParams {
  return { transactionId: path.string('transactionId') };
}

export const TRANSACTION_FAKES: FakeSpecTable<TransactionsResource> = {
  get: {
    endpoint: ENDPOINTS.getTransactions,
    encode: encodeRequestedTransaction,
    decodeRequest: decodeGetRequest,
    matches: isSingleRead,
    // An unknown id is an empty list, not an error (W c144).
    miss: {
      code: 'transaction_not_found',
      payload: { totalTransaction: 0, transactions: [] },
    },
  },
  list: {
    endpoint: ENDPOINTS.getTransactions,
    encode: encodeTransactionPage,
    decodeRequest: decodeListRequest,
    matches: (request) => !isSingleRead(request),
  },
  getRrn: {
    endpoint: ENDPOINTS.getRrn,
    encode: encodeRrn,
    decodeRequest: decodeGetRrnRequest,
  },
};
