# Splits and sub-merchants

`paylov.splits` divides a paid transaction among recipients; `paylov.subMerchants` creates child
merchants. Paylov enables each feature per merchant (`permission_denied` otherwise).

## Split a paid transaction

```ts
import { isPaylovApiError } from '@isroilov_an/paylov';

try {
  await paylov.splits.create({
    transactionId,
    recipients: [
      { recipientId: platformRecipientId, amountTiyin: 150_000 },
      { recipientId: sellerRecipientId, amountTiyin: 850_000, items: sellerItems },
    ],
  });
} catch (error) {
  if (!isPaylovApiError(error, 'split_already_done')) throw error;
}
const split = await paylov.splits.get({ transactionId });
```

- Splitting moves money to the recipients; amounts must add up to the transaction amount, and the
  transaction must be paid (`receipt_not_available_for_split` otherwise).
- Read the split back with the paid transaction's id. `splits.get` throws `split_not_found` for a
  transaction without a split and `transaction_not_found` for an unknown one.
- Recipients are ids Paylov issues. Paylov's test environment accepted only the merchant's own id
  (the `serviceId` a hold reports); whether sub-merchant ids are recipients is undocumented.
- `payments.refund` of the paid transaction refunds the split: every share reads `cancelled`.

## Fiscal receipts

- A recipient's `items` ([fiscalization.md](fiscalization.md)) are registered with the OFD in the
  background. Each item needs `tin` or `pinfl` (`ofd_comitent_not_provided` otherwise).
- Poll `splits.get`: `receipt` turns from `null` to the sale receipt seconds after the split, and to
  the refund receipt seconds after a refund.
- A rejected item leaves `receipt` `null` and reports nothing. Resubmit corrected items with
  `splits.resendReceipt`: it splits nothing, moves no money, and returns the OFD's previous error as
  `lastOfdError`. `ofd_check_already_generated` means a receipt already exists. Paylov does not say
  whether a resend while the first submission is still pending registers twice, so wait before
  resending.

```ts
const split = await paylov.splits.get({ transactionId });
if (split.receipt === null && Date.now() - splitAt.getTime() > 60_000) {
  const { lastOfdError } = await paylov.splits.resendReceipt({
    transactionId,
    recipients: [{ recipientId: sellerRecipientId, amountTiyin: 850_000, items: correctedItems }],
  });
  log.warn('split receipt resent', { lastOfdError });
}
```

## Create a sub-merchant

```ts
const { subMerchantId } = await paylov.subMerchants.create({
  name: shop.displayName,
  tin: shop.tin,
  externalId: shop.id,
});
await shops.linkPaylov(shop.id, subMerchantId);
```

- Paylov staff activate a new sub-merchant later.
- No lookup exists: after an ambiguous failure, repeat with the same data and treat
  `sub_merchant_already_created` as success.
