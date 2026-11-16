import {
  arrayOf,
  asBoolean,
  asNonNegativeInteger,
  asString,
  fieldOf,
  DecodeFailure,
  readFields,
  type Decoder,
} from '../core/decoding.js';
import type {
  ActivityTypeCheck,
  FiscalReceipt,
  FiscalReceiptRegistered,
  FiscalReceiptRefunded,
} from './types.js';

const decodeOfdReceipt: Decoder<FiscalReceiptRegistered> = (value, path) => {
  const field = readFields(value, path);
  return {
    receiptId: field('receiptId', asNonNegativeInteger),
    receiptUrl: field('receiptUrl', asString),
    terminalId: field('terminalId', asString),
    fiscalSign: field('fiscalSign', asString),
  };
};

export const decodeFiscalReceiptRegistered: Decoder<FiscalReceiptRegistered> = fieldOf(
  'ofd',
  decodeOfdReceipt,
);

/**
 * A known transaction without a receipt answers `success: false` with `receiptUrl` and
 * `isRefund` null and the other receipt keys absent (W c274); an unknown id is an API error.
 */
export const decodeReceiptLookup: Decoder<FiscalReceipt | null> = (value, path) => {
  const field = readFields(value, path);
  if (!field('success', asBoolean)) return null;
  return {
    ...decodeOfdReceipt(value, path),
    isRefund: field('isRefund', asBoolean),
  };
};

export const decodeReceiptRefunded: Decoder<FiscalReceiptRefunded> = (value, path) => {
  const field = readFields(value, path);
  return {
    refund: field('ofd', fieldOf('refund', decodeOfdReceipt)),
    sale: field('sale', decodeOfdReceipt),
  };
};

/** `result.error` sits beside `success` and is ignored; only `success: true` is a success. */
export const decodeAttachConfirmation: Decoder<void> = (value, path) => {
  if (!fieldOf('success', asBoolean)(value, path)) {
    throw new DecodeFailure(`${path}.success`);
  }
};

interface ActivityTypeDetails {
  /** The high-income answer; `undefined` when `success` is the whole answer. */
  readonly status: boolean | undefined;
  readonly activityNames: readonly string[];
}

/**
 * `data` is `null` (self-employed), the number 200 (a negative entrepreneur check, discarded) or
 * the high-income object, whose `status` is the answer while `success` only says the check ran.
 */
const decodeActivityTypeDetails: Decoder<ActivityTypeDetails> = (value, path) => {
  if (value === null || value === undefined || typeof value === 'number') {
    return { status: undefined, activityNames: [] };
  }
  const field = readFields(value, path);
  return {
    status: field('status', asBoolean),
    activityNames: field('activityNames', arrayOf(asString)),
  };
};

/** The upstream `reason` is free text from the tax service and is never read. */
export const decodeActivityTypeCheck: Decoder<ActivityTypeCheck> = (value, path) => {
  const field = readFields(value, path);
  const success = field('success', asBoolean);
  const { status = true, activityNames } = field('data', decodeActivityTypeDetails);
  return { isConfirmed: success && status, activityNames };
};
