# Transactions

`transactions.get` is the reconciliation read for every payment kind: saved card, PAN and hold.
`transactions.list` is a settled-sales feed.

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

const state = readRefundState({ transaction: await paylov.transactions.get({ transactionId }) });
if (state.kind === 'refunded') await orders.markRefunded(orderId, state.refundedAt);
else if (state.kind === 'unknown') await jobs.reconcileLater(orderId);
```

- `refunded` needs a non-hold transaction reading `refunded` with `cancelledAt`; `not_refunded`
  needs `paid` with no `cancelledAt`. Everything else is `unknown`: other statuses, and a hold
  reading `refunded`, which may be a release rather than a refund.
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
- `iterate` requests pages from 1 and stops at `total` rows or an empty page; the page size is
  undocumented. Two pages in a row with no new row throw `PaylovProtocolError` instead of looping.
  Pass `{ signal }` to stop it; breaking out of the loop stops it too. Use `list` for one page.
- Rows already seen are skipped, so none repeats when a sale paid mid-loop pushes rows to a later
  page. A refund made mid-loop can shift an unseen row to an earlier page and out of reach. Iterate
  a closed date range for reconciliation.
