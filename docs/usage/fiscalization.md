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

- A card payment passes its paid `transactionId`; a cash sale passes `externalId` (your receipt key)
  and `phoneNumber`.
- Store every `receiptId` (a number) with its `transactionId` or `externalId`: refunds and recovery
  need it.
- Use `count: 1` per item, with any `discountTiyin` on that item: Paylov does not document whether
  `priceTiyin` is the unit price or the line total, or whether a discount applies per unit or to the
  line, and with `count: 1` every reading gives the same total. Verify any other count on the
  development gateway first. Paylov states no unit for the discount; the SDK sends tiyin.
- Paylov does not document which payments it fiscalizes itself; agree it with Paylov as part of your
  merchant setup. `attachReceipt` needs client-side fiscalization. The SDK cannot tell which
  applies: read `getReceipt` before registering.
- Pass `isRefund` explicitly to `getReceipt`; which receipt comes back without it is undocumented.
- `null` from `getReceipt` is not final: the OFD may register a receipt later.

## Refund receipts

- `payments.refund` cancels the payment's fiscalization. Afterwards read
  `getReceipt({ transactionId, isRefund: true })`, and call `refundReceipt` with the sale's
  `receiptId` only when that read shows no refund receipt.
- For a cash sale, `refundReceipt({ receiptId })` reverses the stored sale receipt.

## Activity types

`checkActivityType` may answer a negative result as `gateway_not_working` instead of
`isConfirmed: false`: treat it as not confirmed, and retry later if the tax service may have been
down.

Recovery: [errors.md](errors.md#recovery-after-an-ambiguous-failure).
