# Checkout

`createCheckoutUrl` builds a link to Paylov's hosted payment page, where the customer enters the
card. Pure: no client, no request. Paylov then calls your `transaction.check` and
`transaction.perform` webhooks ([webhooks.md](webhooks.md)).

## Hosted checkout link

```ts
import { createCheckoutUrl } from '@isroilov_an/paylov';

const url = createCheckoutUrl({
  merchantId: paylovMerchantId,
  amount: { currency: 860, amountTiyin: 50_000 }, // USD: { currency: 840, amountCents }
  account: { order_id: 'A-1001' },
  returnUrl: 'https://shop.example/checkout/return',
});
await orders.saveCheckoutAccount('A-1001', { order_id: 'A-1001' });
```

- **The link is unsigned.** Anyone who sees it can change amount, currency or account. Re-validate
  all three in `transaction.check` and `transaction.perform` before answering `accept`.
- **The return carries no outcome.** Only `transaction.perform` or a status read confirms payment.
- **Production only.** No DEV checkout page is known.
- **Keep your own order mapping.** Send at least one `account` entry so `transaction.check` has a
  key to match. The check and perform webhooks carry the keys you sent; `transactions.get` does not
  return them.
- **`convertTo`** converts at the Central Bank rate when the check is created. Paylov says the
  transaction is then generated in the `convertTo` currency; the SDK assumes the webhooks carry that
  currency at the converted amount, not the order's original amount. Each webhook states its own
  currency, so check it. Use `convertTo` only if you can accept the converted amount, and agree the
  currencies and conversions you get with Paylov.
- Unknown merchants and out-of-range amounts fail on the page, after the redirect.
