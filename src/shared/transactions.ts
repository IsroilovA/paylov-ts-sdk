/** Transaction shapes shared by the features that create, act on or read transactions. */

import { asString, fieldOf, type Decoder } from '../core/decoding.js';

/** The gateway transaction an operation created or acted on. */
export interface TransactionReference {
  /** Gateway transaction id. */
  readonly transactionId: string;
}

/**
 * Decodes a status string, replacing each wire spelling in `statusByWire` with the SDK's word.
 * Other values pass through unchanged.
 */
export function statusDecoder(statusByWire: ReadonlyMap<string, string>): Decoder<string> {
  return (value, path) => {
    const status = asString(value, path);
    return statusByWire.get(status) ?? status;
  };
}

/** Decodes `{ transactionId }`. */
export const decodeTransactionReference: Decoder<TransactionReference> = (value, path) => ({
  transactionId: fieldOf('transactionId', asString)(value, path),
});
