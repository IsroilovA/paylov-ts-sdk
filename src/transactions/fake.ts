import {
  nullableOf,
  optionalEntry,
  tashkentDateTimeOf,
  utcDateTimeOf,
  type FakeCodec,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
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

function encodeTransaction(transaction: Transaction): unknown {
  return {
    id: transaction.transactionId,
    external_id: transaction.externalId,
    userId: transaction.userId,
    card_id: transaction.cardId,
    cardNumber: transaction.maskedCardNumber,
    amount_in_tiyin: transaction.amountTiyin,
    status: encodeStatus(TRANSACTION_STATUS_BY_WIRE, transaction.status),
    account: {},
    error_message: transaction.declineCode,
    date: tashkentDateTimeOf(transaction.paidOrCreatedAt, 'paidOrCreatedAt'),
    cancel_time: nullableOf(transaction.cancelledAt, (date) =>
      tashkentDateTimeOf(date, 'cancelledAt'),
    ),
    is_hold: transaction.isHold,
    is_split: transaction.isSplit,
    is_a2c: transaction.isA2c,
    via_link: null,
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

function decodeRrnRequest({ path }: FakeRequest): GetRrnParams {
  return { transactionId: path.string('transactionId') };
}

export const TRANSACTION_CODECS: {
  readonly get: FakeCodec<Transaction, GetTransactionParams>;
  readonly list: FakeCodec<TransactionPage, ListTransactionsParams>;
} = {
  get: {
    encode: encodeRequestedTransaction,
    decodeRequest: decodeGetRequest,
    matches: isSingleRead,
  },
  list: {
    encode: encodeTransactionPage,
    decodeRequest: decodeListRequest,
    matches: (request: FakeRequest) => !isSingleRead(request),
  },
};

export function createTransactionsFake(
  script: Scripter<'transactions', TransactionsResource>,
): PaylovFakeSurface<TransactionsResource> {
  return {
    get: script(
      'transactions.get',
      ENDPOINTS.getTransactions,
      TRANSACTION_CODECS.get.encode,
      TRANSACTION_CODECS.get.decodeRequest,
      TRANSACTION_CODECS.get.matches,
    ),
    list: script(
      'transactions.list',
      ENDPOINTS.getTransactions,
      TRANSACTION_CODECS.list.encode,
      TRANSACTION_CODECS.list.decodeRequest,
      TRANSACTION_CODECS.list.matches,
    ),
    getRrn: script('transactions.getRrn', ENDPOINTS.getRrn, encodeRrn, decodeRrnRequest),
  };
}
