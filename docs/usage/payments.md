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

- `account` is your JSON object, sent as given; the SDK sends `{}` when you omit it. A top-level
  array, string or other non-object fails with `sdk_invalid_input` before any request. Inside it,
  values may be plain objects, arrays, strings, finite numbers, booleans and `null`. A property set
  to `undefined` is left out. Anything else (`NaN`, a `BigInt`, a `Date`, a function, an `undefined`
  array entry, a cycle, or nesting deeper than 64 levels) fails with `sdk_invalid_input` before any
  request.
- Store the `transactionId` with your order before calling `pay`: it is the key for reconciliation
  and for any repeat.
- After a decline, read the transaction: `failed` can never be paid again; `created` can be paid
  with another card.

## Pay by card number

Your server handles the full card number, which puts it in PCI scope: take it from secure input and
never log or store it.

```ts
import { sumToTiyin } from '@isroilov_an/paylov';

const started = await paylov.payments.startPanPayment({
  cardNumber: cardNumberFromSecureInput,
  cardExpiry: cardExpiryFromSecureInput, // YYMM
  amountTiyin: sumToTiyin(1200),
  account: { order_id: 'A-1025' },
});
showOtpPrompt(`Uzcard/Humo sent a code to the phone linked to your card: ${started.otpSentPhone}`);
await paylov.payments.confirmPanPayment({ transactionId: started.transactionId, otp: otpFromUser });
```

- OTP delivery and lifetime match PAN binding ([cards.md](cards.md#pan-binding)). Wrong codes are
  counted per flow: the fourth wrong code answers `card_is_blocked`, and a block that PAN binding
  started still let this confirm answer `invalid_otp` three times first.
- There is no external id; keep the `transactionId`.

## Refund

- Always the full amount. For a fiscalized payment Paylov registers the refund receipt within
  seconds to minutes ([fiscalization.md](fiscalization.md#refund-receipts)). The transaction then
  reads `refunded` and drops out of `transactions.list`.
- Saved-card and PAN payments and captured holds are all refundable through `payments.refund`, per
  Paylov. Its test environment refused PAN payments, and answered `processing_error` for captured
  holds, which then still read `paid`. Before capture, release a hold instead.
- Refund within your merchant's refund window: Paylov agrees it with each merchant. Its test
  environment refused saved-card payments about 11 days old with
  `transaction_not_available_for_cancel`, leaving them `paid`. Past the window, use the business
  panel or Paylov support.
- Keep refunds an admin action: Paylov documents no fee terms.

After an ambiguous failure of `pay`, `confirmPanPayment` or `refund`, follow
[errors.md](errors.md#recovery-after-an-ambiguous-failure). Settle a refund with `readRefundState`
([transactions.md](transactions.md#refund-state)), never with the status alone: a released hold also
reads `refunded`. For a hold you captured, pass `isCaptured: true`: `readRefundState` then gives
`not_refunded` while it still reads `paid` and `refunded` once it reads `refunded` with a refund
time. Without it, a hold reading `refunded` is `unknown`.
