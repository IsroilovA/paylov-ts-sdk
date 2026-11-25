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
      { recipientId: platformRecipientId, amountTiyin: 150_000, items: platformItems },
      { recipientId: sellerRecipientId, amountTiyin: 850_000, items: sellerItems },
    ],
  });
} catch (error) {
  if (!isPaylovApiError(error, 'split_already_done')) throw error;
}
const split = await paylov.splits.get({ transactionId });
```

- Splitting moves money to the recipients; the recipient amounts must add up to the transaction
  amount (`invalid_amount` otherwise), and the transaction must be paid
  (`receipt_not_available_for_split` otherwise). Item prices need not match a recipient's amount.
- Read the split back with the paid transaction's id. `splits.get` throws `split_not_found` for a
  transaction without a split and `transaction_not_found` for an unknown one. Right after an
  ambiguous `splits.create`, `split_not_found` proves nothing: read again after a backoff before
  splitting again.
- Recipients are ids Paylov issues. Paylov's test environment accepted only the merchant's own id
  (the `serviceId` a hold reports); whether sub-merchant ids are recipients is undocumented.
- `payments.refund` of the paid transaction refunds the split: every share reads `cancelled`.

## Fiscal receipts

- A recipient's `items` ([fiscalization.md](fiscalization.md)) are registered with the OFD in the
  background. Each item needs exactly one of `tin` or `pinfl`; the SDK rejects an item with neither
  or both as `sdk_invalid_input` before sending, in `splits.create` and `splits.resendReceipt`. An
  item whose `tin` or `pinfl` has no active OFD contract fails `splits.create` with
  `ofd_commitent_or_subcommission_not_active`.
- Poll `splits.get`: `receipt` turns from `null` to the sale receipt seconds after the split, and to
  the refund receipt seconds after a refund.
- A rejected item leaves `receipt` `null` and reports nothing. Resubmit corrected items with
  `splits.resendReceipt`: it splits nothing, moves no money, and returns the resubmission `status`.
  Send every recipient of the split with its original amount and its items; the SDK rejects a
  recipient without items locally as `sdk_invalid_input`. `ofd_check_already_generated` means a
  receipt already exists. A receipt in `splits.get` afterwards shows that a receipt exists, not that
  the resend registered it: the original submission or a refund can produce it too, and `isRefund`
  tells a refund receipt from a sale receipt. Paylov does not say whether a resend while the first
  submission is still pending registers twice, so wait before resending.

```ts
const split = await paylov.splits.get({ transactionId });
if (split.receipt === null && Date.now() - splitAt.getTime() > 60_000) {
  const { status } = await paylov.splits.resendReceipt({
    transactionId,
    recipients: [
      { recipientId: platformRecipientId, amountTiyin: 150_000, items: platformItems },
      { recipientId: sellerRecipientId, amountTiyin: 850_000, items: correctedSellerItems },
    ],
  });
  log.warn('split receipt resent', { status });
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
- No lookup exists: after an ambiguous failure, repeat with the same data.
  `sub_merchant_already_created` then leaves the result unresolved: Paylov answers it when any of
  `name`, `tin`, `pinfl` or `externalId` collides with one of your sub-merchants and returns no id,
  so it does not prove the intended child exists. Confirm the child and its id with Paylov before
  linking it.
