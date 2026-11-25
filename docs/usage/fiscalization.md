# Fiscalization

`paylov.fiscalization` registers OFD fiscal receipts and checks activity types. None of it moves
money; refund a payment with `payments.refund`.

## Register a receipt

```ts
import { isPaylovApiError } from '@isroilov_an/paylov';

const items = [
  {
    title: 'Consultation',
    priceTiyin: 25_000_000,
    count: 1,
    code: ikpuCode,
    vatPercent: 12,
    packageCode,
    tin: commitentTin,
  },
];

try {
  const receipt = await paylov.fiscalization.registerReceipt({ transactionId, items });
  await receipts.save(transactionId, receipt.receiptId, receipt.receiptUrl);
} catch (error) {
  if (!isPaylovApiError(error, 'ofd_check_already_generated')) throw error;
  const existing = await paylov.fiscalization.getReceipt({ transactionId, isRefund: false });
  if (existing !== null) {
    await receipts.save(transactionId, existing.receiptId, existing.receiptUrl);
  }
}
```

- Receipts are registered for paid card payments only, by `transactionId`; the SDK does not
  fiscalize cash sales or attach receipts fiscalized elsewhere.
- Store every `receiptId` (a number) with its `transactionId`: refunds and recovery need it.
- `priceTiyin` is the price of one unit and `discountTiyin` comes off each unit, so a line totals
  `(priceTiyin - discountTiyin) * count`; the lines must add up to the transaction amount, else
  `invalid_amount`. Paylov documents no formula or discount unit: this is the SDK's reading, and the
  SDK sends tiyin.
- Paylov does not document which payments it fiscalizes itself; agree it with Paylov as part of your
  merchant setup. The SDK cannot tell whether Paylov fiscalizes automatically: read `getReceipt`
  before registering.
- Each item's `packageCode` must be the package code the tax classifier (tasnif.soliq.uz) lists for
  its IKPU `code`; a mismatch fails with `ofd_error` and registers nothing, so fix the item and
  register again.
- Without `isRefund`, `getReceipt` returns the refund receipt once one exists, otherwise the sale
  receipt.
- `null` from `getReceipt` is not final: the OFD may register a receipt later. An unknown
  `transactionId` throws `transaction_not_found`.

## Refund receipts

- `payments.refund` makes Paylov register the payment's refund receipt, within seconds to minutes in
  Paylov's test environment, not at once. Afterwards read
  `getReceipt({ transactionId, isRefund: true })` until it returns the receipt; call `refundReceipt`
  with the sale's `receiptId` only when it still shows none after some minutes.
  `ofd_check_already_generated` then means the refund receipt exists.
- `refundReceipt` on a card payment that is not refunded fails with
  `receipt_not_available_for_operation`.

## Activity types

`checkActivityType` may answer a negative result as `gateway_not_working` instead of
`isConfirmed: false`: treat it as not confirmed, and retry later if the tax service may have been
down.

Recovery: [errors.md](errors.md#recovery-after-an-ambiguous-failure).
