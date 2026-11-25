/** Transaction shapes shared by the features that create, act on or read transactions. */

import { asString, DecodeFailure, fieldOf, type Decoder } from '../core/decoding.js';

/** The gateway transaction an operation created or acted on. */
export interface TransactionReference {
  /** Gateway transaction id. */
  readonly transactionId: string;
}

/**
 * Decodes a status string, replacing each wire spelling in `statusByWire` with the SDK's word.
 * Other values pass through unchanged, except an SDK word that is not its own wire spelling: it
 * would read as the status it renames, so it fails to decode.
 */
export function statusDecoder(statusByWire: ReadonlyMap<string, string>): Decoder<string> {
  const sdkWords = new Set(statusByWire.values());
  return (value, path) => {
    const status = asString(value, path);
    const renamed = statusByWire.get(status);
    if (renamed !== undefined) return renamed;
    if (sdkWords.has(status)) throw new DecodeFailure(path);
    return status;
  };
}

/** Decodes `{ transactionId }`. */
export const decodeTransactionReference: Decoder<TransactionReference> = (value, path) => ({
  transactionId: fieldOf('transactionId', asString)(value, path),
});
