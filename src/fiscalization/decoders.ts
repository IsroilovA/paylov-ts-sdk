import {
  arrayOf,
  asBoolean,
  asString,
  fieldOf,
  readFields,
  type Decoder,
} from '../core/decoding.js';
import {
  decodeFiscalReceipt,
  decodeRegisteredReceipt,
  type FiscalReceipt,
  type FiscalReceiptRegistered,
} from '../shared/fiscalReceipts.js';
import type { ActivityTypeCheck, FiscalReceiptRefunded } from './types.js';

export const decodeFiscalReceiptRegistered: Decoder<FiscalReceiptRegistered> = fieldOf(
  'ofd',
  decodeRegisteredReceipt,
);

/**
 * A known transaction without a receipt answers `success: false` with `receiptUrl` and
 * `isRefund` null and the other receipt keys absent; an unknown id is an API error.
 */
export const decodeReceiptLookup: Decoder<FiscalReceipt | null> = (value, path) => {
  const field = readFields(value, path);
  return field('success', asBoolean) ? decodeFiscalReceipt(value, path) : null;
};

export const decodeReceiptRefunded: Decoder<FiscalReceiptRefunded> = (value, path) => {
  const field = readFields(value, path);
  return {
    refund: field('ofd', fieldOf('refund', decodeRegisteredReceipt)),
    sale: field('sale', decodeRegisteredReceipt),
  };
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
