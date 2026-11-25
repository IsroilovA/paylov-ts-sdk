import {
  arrayOf,
  asBoolean,
  asMaskedPan,
  asNonNegativeInteger,
  asString,
  asTashkentDateTime,
  asTiyin,
  asUtcDateTime,
  fieldOf,
  DecodedMiss,
  DecodeFailure,
  nullable,
  readFields,
  type Decoder,
} from '../core/decoding.js';
import { statusDecoder } from '../shared/transactions.js';
import type {
  FiscalReceiptSummary,
  Transaction,
  TransactionPage,
  TransactionStatus,
} from './types.js';

/**
 * The SDK's word for each wire status it renames. The fake encodes a word as its first wire
 * spelling here.
 */
export const TRANSACTION_STATUS_BY_WIRE: ReadonlyMap<string, TransactionStatus> = new Map([
  ['waiting', 'held'],
  ['payed', 'paid'],
  ['cancel', 'refunded'],
  // On DEV `cancel` marked a refunded sale and a dismissed hold, `refunded` an expired hold Paylov
  // released after a failed capture, against the vendor's "Refunded"; both mean the money went back,
  // so both read `refunded`.
  ['refunded', 'refunded'],
]);

const decodeTransactionStatus = statusDecoder(TRANSACTION_STATUS_BY_WIRE);

const decodeFiscalReceiptSummary: Decoder<FiscalReceiptSummary> = (value, path) => {
  const receipt = readFields(value, path);
  return {
    receiptId: receipt('receipt_id', asNonNegativeInteger),
    receiptUrl: receipt('qr_code_url', asString),
    issuedAt: receipt('date_time', asUtcDateTime),
    isRefund: receipt('is_refund', asBoolean),
  };
};

/**
 * Withholds `owner` (cardholder name), the float SUM `amount`, the label `transaction_type`, the
 * hosted-checkout flag `via_link` and `account`, which reads `{}` whatever was sent.
 */
const decodeTransaction: Decoder<Transaction> = (value, path) => {
  const transaction = readFields(value, path);
  return {
    transactionId: transaction('id', asString),
    externalId: transaction('external_id', nullable(asString)),
    userId: transaction('userId', nullable(asString)),
    cardId: transaction('card_id', nullable(asString)),
    maskedCardNumber: transaction('cardNumber', nullable(asMaskedPan)),
    amountTiyin: transaction('amount_in_tiyin', asTiyin),
    status: transaction('status', decodeTransactionStatus),
    declineCode: transaction('error_message', nullable(asString)),
    paidOrCreatedAt: transaction('date', asTashkentDateTime),
    cancelledAt: transaction('cancel_time', nullable(asTashkentDateTime)),
    isHold: transaction('is_hold', asBoolean),
    isSplit: transaction('is_split', asBoolean),
    isA2c: transaction('is_a2c', asBoolean),
    fiscalReceipts: transaction('ofd', arrayOf(decodeFiscalReceiptSummary)),
  };
};

export const decodeTransactionPage: Decoder<TransactionPage> = (value, path) => {
  const page = readFields(value, path);
  return {
    total: page('totalTransaction', asNonNegativeInteger),
    transactions: page('transactions', arrayOf(decodeTransaction)),
  };
};

const decodeRows = fieldOf('transactions', arrayOf(decodeTransaction));

/**
 * The `getTransactions?id=` result. Paylov answers an unknown id with no row, which reads as
 * `transaction_not_found`. Without a usable `id` the endpoint lists paid transactions instead, so
 * any other row, or more than one, is malformed.
 */
export function decodeRequestedTransaction(transactionId: string): Decoder<Transaction> {
  return (value, path) => {
    const rows = decodeRows(value, path);
    const [row] = rows;
    if (row === undefined) throw new DecodedMiss('transaction_not_found');
    if (rows.length > 1 || row.transactionId.toLowerCase() !== transactionId.toLowerCase()) {
      throw new DecodeFailure(`${path}.transactions`);
    }
    return row;
  };
}

/** `getTransactions/rrn/{id}/` result. */
export const decodeRrn: Decoder<string> = fieldOf('rrn', asString);
