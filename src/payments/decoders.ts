import { asString, asTashkentDateTime, readFields, type Decoder } from '../core/decoding.js';
import { decodeTransactionReference } from '../shared/transactions.js';
import type { PanPaymentStarted, PaymentRefunded } from './types.js';

/** `payment/cancel/` result. */
export const decodePaymentRefunded: Decoder<PaymentRefunded> = (value, path) => {
  const field = readFields(value, path);
  return {
    ...decodeTransactionReference(value, path),
    refundedAt: field('cancelTime', asTashkentDateTime),
  };
};

/** `paymentWithoutRegistration/` result; the echoed `extId` and the `code` are withheld. */
export const decodePanPaymentStarted: Decoder<PanPaymentStarted> = (value, path) => {
  const field = readFields(value, path);
  return {
    ...decodeTransactionReference(value, path),
    otpSentPhone: field('otpSentPhone', asString),
  };
};
