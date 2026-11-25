/** Shared compile-time helpers for the contracts in this directory. */

/** `true` only when `A` and `B` are the same type: a widened or narrowed type is `false`. */
export type IsEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
