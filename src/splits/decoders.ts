import { arrayOf, asString, asTiyin, readFields, type Decoder } from '../core/decoding.js';
import type { SplitShare } from './types.js';

/** One `splitPayment/status/` entry; `amount` is tiyin. */
const decodeSplitShare: Decoder<SplitShare> = (value, path) => {
  const field = readFields(value, path);
  return {
    recipientId: field('recipientId', asString),
    amountTiyin: field('amount', asTiyin),
    status: field('status', asString),
    createdAtRaw: field('createdAt', asString),
  };
};

/** `splitPayment/status/` result: one entry per recipient. */
export const decodeSplitShares: Decoder<readonly SplitShare[]> = arrayOf(decodeSplitShare);
