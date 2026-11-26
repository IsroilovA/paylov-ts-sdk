# Transactions

`transactions.get` reads any of the merchant's transactions, whatever created it: SDK payments and
holds, and payments made elsewhere, such as through Paylov's hosted checkout. It is the
reconciliation read after an ambiguous `payments.pay`, `payments.confirmPanPayment` or
`payments.refund`; an ambiguous `holds.create` is read with `holds.get({ externalId })`, a hold's
capture or release with `holds.get`, and a split with `splits.get`
([recovery](errors.md#recovery-after-an-ambiguous-failure)). `transactions.list` is a settled-sales
feed.

## Reconcile one payment

```ts
import { isPaylovApiError } from '@isroilov_an/paylov';

try {
  const transaction = await paylov.transactions.get({ transactionId });
  if (transaction.status === 'paid') await orders.markPaid(orderId, transaction.paidOrCreatedAt);
} catch (error) {
  // Unknown to the gateway so far: read again after a delay before creating anew.
  if (!isPaylovApiError(error, 'transaction_not_found')) throw error;
  await jobs.reconcileLater(orderId);
}
```

- Paylov answers an unknown id with an empty list; the SDK throws that as `transaction_not_found`,
  the code `holds.get` throws. Right after an ambiguous call it does not prove the call did not run.

- `status` is open: handle values you do not know. A refunded sale reads `refunded`. A hold reads
  `held`, as in `holds.get`, until captured (`paid` here, `captured` in `holds.get`); a declined
  hold reads `failed` (`declined` in `holds.get`). A released hold also reads `refunded`, whether
  dismissed before or after expiry or released by Paylov after a failed capture, so for a hold
  `refunded` means only that the merchant keeps no money from it; read `holds.get` to tell a release
  from a capture.
- Recovery per method: [errors.md](errors.md#recovery-after-an-ambiguous-failure).

## Refund state

```ts
import { readRefundState } from '@isroilov_an/paylov';

const transaction = await paylov.transactions.get({ transactionId });
// `isCaptured: true` only for a hold this order captured with `paylov.holds.capture`.
const state = readRefundState({ transaction, isCaptured: order.holdCapturedAt !== null });
if (state.kind === 'refunded') await orders.markRefunded(order.id, state.refundedAt);
else if (state.kind === 'unknown') await jobs.reconcileLater(order.id);
```

- `refunded` needs a sale (`isHold` false) reading `refunded` with a valid `cancelledAt`;
  `not_refunded` needs `paid` with no `cancelledAt`, a captured hold included. Everything else is
  `unknown`: other statuses, and a hold reading `refunded`, which reads the same after a release as
  after a refund.
- `isCaptured: true` asserts that you captured the hold, which also means it was never released: a
  hold then reading `refunded` with a valid `cancelledAt` is `refunded`. Pass it only from your own
  record of a successful `holds.capture`; the read itself cannot tell a capture from a release.
- `not_refunded` is a reading at one moment: after an ambiguous refund, read again with backoff
  before repeating it ([errors.md](errors.md#recovery-after-an-ambiguous-failure)).

## Settled sales

```ts
import type { Transaction } from '@isroilov_an/paylov';

const sales: Transaction[] = [];
for await (const transaction of paylov.transactions.iterate({
  fromDate: '2026-11-01',
  toDate: '2026-11-30',
})) {
  sales.push(transaction);
}
```

- Only currently paid transactions appear, merchant-wide: a refunded payment disappears. Never use
  the list to reconcile one payment or to find refunds.
- Dates are Tashkent calendar days, UTC+05:00; `toDate` is included.
- Rows come in the gateway's order: roughly newest payment first, but not strictly. Sort them where
  order matters.
- `iterate` requests pages from 1 and stops at `total` rows or an empty page; the page size is
  undocumented. Two pages in a row with no new row throw `PaylovProtocolError` instead of looping.
  Pass `{ signal }` to stop it; breaking out of the loop stops it too. Use `list` for one page.
- Rows already seen are skipped, so none repeats when a sale paid mid-loop pushes rows to a later
  page. A refund made mid-loop can shift an unseen row to an earlier page and out of reach. Iterate
  a closed date range for reconciliation.
