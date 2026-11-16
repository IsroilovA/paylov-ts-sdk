/** Number guards shared by money, time and decoding. */

/** A count, an id, a timestamp in seconds, or an amount in a minor unit. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
