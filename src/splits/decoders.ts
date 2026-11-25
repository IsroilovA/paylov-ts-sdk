import {
  arrayOf,
  asString,
  asTashkentDateTime,
  asTiyin,
  isRecord,
  readFields,
  type Decoder,
} from '../core/decoding.js';
import { decodeFiscalReceipt, type FiscalReceipt } from '../shared/fiscalReceipts.js';
import type { Split, SplitReceiptResent, SplitShare } from './types.js';

/** One recipient entry of `splitPayment/status/`; `amount` is tiyin. */
const decodeSplitShare: Decoder<SplitShare> = (value, path) => {
  const field = readFields(value, path);
  return {
    recipientId: field('recipientId', asString),
    amountTiyin: field('amount', asTiyin),
    status: field('status', asString),
    createdAt: field('createdAt', asTashkentDateTime),
  };
};

/** The OFD sends `{}` until a receipt exists. */
const decodeSplitReceipt: Decoder<FiscalReceipt | null> = (value, path) =>
  isRecord(value) && Object.keys(value).length === 0 ? null : decodeFiscalReceipt(value, path);

type SplitEntry =
  | { readonly share: SplitShare; readonly receipt?: undefined }
  | { readonly share?: undefined; readonly receipt: FiscalReceipt | null };

/** The receipt travels as one more `result` entry, `{ "ofd": ... }`, after the recipients. */
const decodeSplitEntry: Decoder<SplitEntry> = (value, path) =>
  isRecord(value) && 'ofd' in value
    ? { receipt: readFields(value, path)('ofd', decodeSplitReceipt) }
    : { share: decodeSplitShare(value, path) };

/** `splitPayment/status/` result: the recipient entries, then the receipt entry. */
export const decodeSplit: Decoder<Split> = (value, path) => {
  const entries = arrayOf(decodeSplitEntry)(value, path);
  return {
    shares: entries.flatMap(({ share }) => (share === undefined ? [] : [share])),
    receipt: entries.find(({ receipt }) => receipt !== undefined)?.receipt ?? null,
  };
};

/**
 * `splitPayment/` result of a `resendOFD` call. `lastOfdError` is skipped: it is the OFD's raw
 * answer to the previous submission.
 */
export const decodeSplitReceiptResent: Decoder<SplitReceiptResent> = (value, path) => {
  const field = readFields(value, path);
  return {
    transactionId: field('transactionId', asString),
    status: field('status', asString),
  };
};
