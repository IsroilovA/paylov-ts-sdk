import {
  asString,
  asTiyinFromSum,
  asUtcDateTime,
  nullable,
  readFields,
  type Decoder,
} from '../core/decoding.js';
import { decodeTransactionReference, statusDecoder } from '../shared/transactions.js';
import type { Hold, HoldCaptured, HoldStatus } from './types.js';

/** The SDK's word for each wire status it renames. */
export const HOLD_STATUS_BY_WIRE: ReadonlyMap<string, HoldStatus> = new Map([
  ['hold', 'held'],
  ['paid', 'captured'],
  ['cancelled', 'released'],
]);

const decodeHoldStatus = statusDecoder(HOLD_STATUS_BY_WIRE);

/** `hold/charge/` result; `payedAt` is UTC. */
export const decodeHoldCaptured: Decoder<HoldCaptured> = (value, path) => {
  const field = readFields(value, path);
  return {
    ...decodeTransactionReference(value, path),
    cardId: field('cardId', asString),
    capturedAt: field('payedAt', asUtcDateTime),
  };
};

/** `hold/status/` result; `amount` is whole SUM, `payedAt` and `cancelTime` are UTC. */
export const decodeHold: Decoder<Hold> = (value, path) => {
  const field = readFields(value, path);
  return {
    transactionId: field('transactionId', asString),
    status: field('status', decodeHoldStatus),
    amountTiyin: field('amount', asTiyinFromSum),
    capturedAt: field('payedAt', nullable(asUtcDateTime)),
    releasedAt: field('cancelTime', nullable(asUtcDateTime)),
    serviceId: field('serviceId', asString),
  };
};
