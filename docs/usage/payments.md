# Payments

`paylov.payments` charges a card without a hold and refunds. Reconcile with
[transactions.md](transactions.md); to reserve funds first, use [holds.md](holds.md).

## Charge a saved card

```ts
import { sumToTiyin } from '@isroilov_an/paylov';

// 1. Create: no money moves. The amount must be whole SUM.
const { transactionId } = await paylov.payments.create({
  amountTiyin: sumToTiyin(25_000),
  account: { order_id: 'A-1024' },
  userId: 'user-42',
});
await orders.saveTransaction('A-1024', transactionId);

// 2. Pay: money moves, without an OTP. The card must be bound to the same userId.
await paylov.payments.pay({ transactionId, cardId, userId: 'user-42' });
```

- Store the `transactionId` with your order before calling `pay`: it is the key for reconciliation
  and for any repeat.
- `account` is optional. Keep your own order data: `transactions.get` does not return it.
- After a decline, read the transaction: `failed` can never be paid again; `created` can be paid
  with another card.

## Pay by card number

Your server handles the full card number, which puts it in PCI scope: take it from secure input and
never log or store it.

```ts
const started = await paylov.payments.startPanPayment({
  cardNumber: cardNumberFromSecureInput,
  cardExpiry: cardExpiryFromSecureInput, // YYMM
  amountTiyin: sumToTiyin(1200),
  account: { order_id: 'A-1025' },
});
showOtpPrompt(`Uzcard/Humo sent a code to the phone linked to your card: ${started.otpSentPhone}`);
await paylov.payments.confirmPanPayment({ transactionId: started.transactionId, otp: otpFromUser });
```

- OTP delivery and wrong-code limits are those of PAN binding ([cards.md](cards.md#pan-binding)).
- There is no external id; keep the `transactionId`.

## Refund

- Always the full amount; it also cancels the payment's fiscal receipt. The transaction then reads
  `refunded` and drops out of `transactions.list`.
- Paylov may refuse an API refund for some payment kinds: checkout and PAN payments answer
  `transaction_not_available_for_cancel`, and a captured hold answered `processing_error` on
  Paylov's test environment. Then refund from the Paylov business panel or through Paylov support,
  and confirm with `transactions.get`. Before capture, release a hold instead.
- Keep refunds an admin action: Paylov documents no fee terms.

After an ambiguous failure of `pay`, `confirmPanPayment` or `refund`, follow
[errors.md](errors.md#recovery-after-an-ambiguous-failure).
