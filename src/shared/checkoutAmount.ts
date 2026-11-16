/**
 * A checkout amount in the minor unit of its currency, shared by the checkout link and the
 * check/perform callbacks. The wire carries one integer plus a numeric currency code.
 */

import { isNonNegativeSafeInteger } from '../core/numbers.js';
import { everyLiteral, type Params } from '../core/params.js';

/** Numeric currency codes the checkout accepts: 860 UZS, 840 USD. */
export type CheckoutCurrency = 860 | 840;

/** The `CheckoutCurrency` values, for runtime checks. */
export const CHECKOUT_CURRENCIES: readonly CheckoutCurrency[] = everyLiteral<CheckoutCurrency>()([
  860, 840,
]);

/**
 * An amount in the minor unit of its currency: tiyin for 860 (UZS), cents for 840 (USD).
 *
 * @example
 * const amount: CheckoutAmount = { currency: 860, amountTiyin: 50_000 }; // 500.00 SUM
 */
export type CheckoutAmount =
  | { readonly currency: 860; readonly amountTiyin: number }
  | { readonly currency: 840; readonly amountCents: number };

/** Reads a checkout amount object under `key`; failures are `sdk_invalid_amount`. */
export function readCheckoutAmount(params: Params, key: string): CheckoutAmount {
  return params.object(key, (amount) =>
    amount.literal('currency', CHECKOUT_CURRENCIES) === 860
      ? { currency: 860, amountTiyin: amount.tiyin('amountTiyin') }
      : { currency: 840, amountCents: amount.tiyin('amountCents') },
  );
}

/** The integer the wire carries for the amount. */
export function minorUnitsOf(amount: CheckoutAmount): number {
  return amount.currency === 860 ? amount.amountTiyin : amount.amountCents;
}

/** Decodes a wire minor-unit amount and currency code, or `undefined` when either is invalid. */
export function decodeCheckoutAmount(
  minorUnits: unknown,
  currency: unknown,
): CheckoutAmount | undefined {
  if (!isNonNegativeSafeInteger(minorUnits)) return undefined;
  if (currency === 860) return { currency, amountTiyin: minorUnits };
  if (currency === 840) return { currency, amountCents: minorUnits };
  return undefined;
}
