/** Fiscal receipts the OFD registered, shared by fiscalization and splits. */

import {
  asBoolean,
  asNonNegativeInteger,
  asString,
  readFields,
  type Decoder,
} from '../core/decoding.js';

/** A fiscal receipt the OFD registered. */
export interface FiscalReceipt {
  /** OFD receipt id; keep it with its `transactionId`. */
  readonly receiptId: number;
  /** Public receipt page on `ofd.soliq.uz`. */
  readonly receiptUrl: string;
  readonly terminalId: string;
  readonly fiscalSign: string;
  /** Whether this is a refund receipt rather than a sale receipt. */
  readonly isRefund: boolean;
}

/** A receipt the OFD just registered; registration does not report `isRefund`. */
export type FiscalReceiptRegistered = Omit<FiscalReceipt, 'isRefund'>;

/** Decodes the OFD receipt fields every receipt answer carries. */
export const decodeRegisteredReceipt: Decoder<FiscalReceiptRegistered> = (value, path) => {
  const field = readFields(value, path);
  return {
    receiptId: field('receiptId', asNonNegativeInteger),
    receiptUrl: field('receiptUrl', asString),
    terminalId: field('terminalId', asString),
    fiscalSign: field('fiscalSign', asString),
  };
};

/** Decodes a receipt with its `isRefund` flag. */
export const decodeFiscalReceipt: Decoder<FiscalReceipt> = (value, path) => ({
  ...decodeRegisteredReceipt(value, path),
  isRefund: readFields(value, path)('isRefund', asBoolean),
});
