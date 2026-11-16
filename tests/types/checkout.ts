/** Compile-time contracts for the hosted checkout link. */

import {
  createCheckoutUrl,
  type CheckoutAmount,
  type CreateCheckoutUrlParams,
} from '../../src/index.js';

const params = {
  merchantId: '5eed0000-0000-4000-8000-0000000000aa',
  amount: { currency: 860, amountTiyin: 50_000 },
  account: { order_id: 'A-1001' },
  returnUrl: 'https://shop.example/return',
} satisfies CreateCheckoutUrlParams;
const url: string = createCheckoutUrl(params);
void url;
void createCheckoutUrl({
  ...params,
  amount: { currency: 840, amountCents: 1_999 },
  convertTo: 860,
});

// @ts-expect-error a USD amount is in cents, not tiyin
void createCheckoutUrl({ ...params, amount: { currency: 840, amountTiyin: 1_999 } });
// @ts-expect-error the amount states its currency
void createCheckoutUrl({ ...params, amount: { amountTiyin: 50_000 } });
// @ts-expect-error a bare number is not a checkout amount
void createCheckoutUrl({ ...params, amount: 50_000 });
// @ts-expect-error checkout currencies are the documented closed set
void createCheckoutUrl({ ...params, convertTo: 978 });
// @ts-expect-error checkout account values are strings: callbacks echo them as strings
void createCheckoutUrl({ ...params, account: { order_id: 12 } });
// @ts-expect-error the checkout host is fixed
void createCheckoutUrl({ ...params, baseUrl: 'https://stage.example/' });

declare const amount: CheckoutAmount;
const minorUnits: number = amount.currency === 860 ? amount.amountTiyin : amount.amountCents;
void minorUnits;
// @ts-expect-error narrow on currency before reading the unit
void amount.amountTiyin;
