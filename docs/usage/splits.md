# Splits and sub-merchants

`paylov.splits` divides a paid transaction among recipients; `paylov.subMerchants` creates the child
merchants that receive shares. Paylov enables each feature per merchant (`permission_denied`
otherwise).

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
const shares = await paylov.splits.get({ transactionId });
```

- Splitting moves money to the recipients; amounts must add up to the transaction amount.
- A recipient's `items` ([fiscalization.md](fiscalization.md)) start OFD fiscalization of its share
  in the background; Paylov does not document how the receipt is reported. `resendOfd: true` asks
  Paylov to resend the split to the fiscal system; Paylov does not say when that is needed.
- Read the split back with the paid transaction's id, not the id `create` returns.
- `splits.get` throws on a miss instead of returning `null`.

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
