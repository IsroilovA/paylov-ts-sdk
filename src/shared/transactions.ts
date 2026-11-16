/** Transaction shapes shared by the features that create, look up or read transactions. */

import { asString, fieldOf, type Decoder } from '../core/decoding.js';
import type { Params } from '../core/params.js';

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

/**
 * Exactly one of the gateway `transactionId` or the merchant's own `externalId`.
 *
 * @example
 * const byId: TransactionLookup = { transactionId };
 * const byOrder: TransactionLookup = { externalId: `order-${order.id}` };
 */
export type TransactionLookup =
  // `?: undefined`, not `?: never`, so lookups built by spread still type-check under
  // `exactOptionalPropertyTypes`.
  | { readonly transactionId: string; readonly externalId?: undefined }
  | { readonly externalId: string; readonly transactionId?: undefined };

/**
 * Reads a {@link TransactionLookup}: a `transactionId` or an `externalId`. The result carries
 * only the key given, ready to send.
 */
export function readTransactionLookup(input: Params): TransactionLookup {
  return input.exclusive(['transactionId', 'externalId']) === 'transactionId'
    ? { transactionId: input.string('transactionId') }
    : { externalId: input.string('externalId') };
}
