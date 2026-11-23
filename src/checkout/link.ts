/** Pure hosted-checkout link generation. */

import { invalidInput } from '../core/errors.js';
import { readParams } from '../core/params.js';
import {
  CHECKOUT_CURRENCIES,
  minorUnitsOf,
  readCheckoutAmount,
  type CheckoutAmount,
  type CheckoutCurrency,
} from '../shared/checkoutAmount.js';

/** Paylov's hosted-checkout host. The page exists on production only. */
const DEFAULT_CHECKOUT_ORIGIN = 'https://my.paylov.uz';
const CHECKOUT_PATH = '/checkout/create/';

/**
 * Characters the checkout page can carry in an account key or value. The page splits the
 * decoded query on `&` and `=` and never percent-decodes, so a character that the form encoding
 * escapes (here, or in the vendor's Python reference) reaches `transaction.check` in a different
 * form than the merchant sent, and a raw `=` would truncate the value.
 */
const ACCOUNT_TOKEN = /^[A-Za-z0-9._-]+$/;

/** Parameters for {@link createCheckoutUrl}. */
export interface CreateCheckoutUrlParams {
  /** Public merchant id (UUID). */
  readonly merchantId: string;
  /** Amount in the minor unit of its currency, sent with `amount_in_tiyin=True`. */
  readonly amount: CheckoutAmount;
  /**
   * Merchant order fields, sent as `account.<key>=<value>`. Paylov documents them in the
   * `transaction.check` / `transaction.perform` callbacks, where the check handler matches its
   * order by them, but its test environment stores none of them for a checkout: keep your own
   * mapping from order to link too. Keys and values are limited to `A-Z a-z 0-9 . _ -`.
   */
  readonly account: Readonly<Record<string, string>>;
  /** Absolute `http(s)` URL the customer returns to. Paylov appends no payment outcome. */
  readonly returnUrl: string;
  /**
   * `convert_to`: the currency the page converts the amount into, at the Central Bank rate, when
   * the check is created. Each webhook states its own currency; the SDK expects the check and
   * perform webhooks in the converted currency and amount, which Paylov does not state outright.
   */
  readonly convertTo?: CheckoutCurrency;
  /**
   * The checkout host as a bare `https` origin, without a path; default `https://my.paylov.uz`.
   * The link opens `<baseUrl>/checkout/create/<encoded query>`.
   */
  readonly baseUrl?: string;
}

/**
 * Builds a hosted-checkout URL the customer opens in a browser. Pure: Paylov creates the check
 * only when the page loads, so an unknown merchant or an out-of-range amount surfaces there.
 * Moves no money; the customer pays on Paylov's page.
 *
 * The link is **not signed**: anyone who sees it can alter the amount, the currency or the
 * account. Your `transaction.check` handler must re-validate all three against your own order
 * record. The return redirect carries no outcome; rely on `transaction.perform`.
 *
 * @example
 * const url = createCheckoutUrl({
 *   merchantId: paylovMerchantId,
 *   amount: { currency: 860, amountTiyin: 50_000 }, // 500.00 SUM
 *   account: { order_id: 'A-1001' },
 *   returnUrl: 'https://shop.example/checkout/return',
 * });
 *
 * @throws {@link PaylovInputError} `sdk_invalid_amount` for the amount, `sdk_invalid_input` for
 * any other field. Every failure is local; messages name the field, never a value.
 */
export function createCheckoutUrl(params: CreateCheckoutUrlParams): string {
  const method = 'createCheckoutUrl';
  const input = readParams(params, method);
  const merchantId = input.string('merchantId');
  const amount = readCheckoutAmount(input, 'amount');
  const account = input.stringRecord('account', ACCOUNT_TOKEN);
  // The page assigns `account[key] = value`; for `__proto__` that is a silent no-op.
  if (Object.hasOwn(account, '__proto__')) {
    throw invalidInput(`${method}: account must not have a __proto__ key`, 'account', 'format');
  }
  const returnUrl = input.url('returnUrl');
  const convertTo = input.optionalLiteral('convertTo', CHECKOUT_CURRENCIES);
  const origin = input.optionalHttpsOrigin('baseUrl') ?? DEFAULT_CHECKOUT_ORIGIN;

  // Form-encoded like the vendor's Python `urlencode` reference, then standard padded base64:
  // the page decodes it with `atob`, which rejects base64url.
  const query = new URLSearchParams([
    ['merchant_id', merchantId],
    ['amount', String(minorUnitsOf(amount))],
    ['return_url', returnUrl],
    ...Object.entries(account).map(([key, value]): [string, string] => [`account.${key}`, value]),
    ['amount_in_tiyin', 'True'],
    ['currency_id', String(amount.currency)],
    ...(convertTo === undefined ? [] : [['convert_to', String(convertTo)]]),
  ]).toString();
  return `${origin}${CHECKOUT_PATH}${Buffer.from(query, 'utf8').toString('base64')}`;
}
