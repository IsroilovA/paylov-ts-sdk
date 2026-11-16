# Transactions

`transactions.get` is the reconciliation read for every payment kind: saved card, PAN, hold and
checkout. `transactions.list` is a settled-sales feed.

## Reconcile one payment

```ts
const transaction = await paylov.transactions.get({ transactionId });
if (transaction === null) {
  // Unknown to the gateway so far: read again after a delay before creating anew.
} else if (transaction.status === 'paid') {
  await orders.markPaid(orderId, transaction.paidOrCreatedAt);
}
```

- `status` is open: handle values you do not know. A refunded sale reads `refunded`. A hold reads
  `held`, as in `holds.get`, until captured (`paid` here, `captured` in `holds.get`). An expired
  hold Paylov released has also read `refunded`, so for a hold `refunded` means only that the
  merchant keeps no money from it; read `holds.get` to tell a release from a capture.
- Recovery per method: [errors.md](errors.md#recovery-after-an-ambiguous-failure).

## Settled sales

```ts
import type { Transaction } from '@isroilov_an/paylov';

const sales: Transaction[] = [];
for (let page = 1; ; page += 1) {
  const result = await paylov.transactions.list({
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
    page,
  });
  sales.push(...result.transactions);
  if (result.transactions.length === 0 || sales.length >= result.total) break;
}
```

- Only currently paid transactions appear, merchant-wide: a refunded payment disappears. Never use
  the list to reconcile one payment or to find refunds.
- Page until a page is empty or you have `total` rows; the page size is undocumented.
- Dates are Tashkent calendar days; `toDate` is included.
