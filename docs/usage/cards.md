# Cards

A bound card's `cardId` is what payments and holds charge. Cards are bound by card number and OTP,
which puts your backend in PCI scope.

## PAN binding

```ts
const started = await paylov.cards.startPanBinding({
  userId: 'user-42',
  cardNumber: panFromSecureInput,
  cardExpiry: expiryFromSecureInput, // YYMM, year first
});
showOtpPrompt(`Uzcard/Humo sent a code to the phone linked to your card: ${started.otpSentPhone}`);
const card = await paylov.cards.confirmPanBinding({
  cardId: started.cardId,
  otp: otpFromCardholder,
});
await userCards.save('user-42', card.cardId);
```

- The card's processing center sends the OTP by SMS, from `UZCARD` or `HUMO`, and the text may not
  name your business until Paylov assigns you an SMS name. Tell the cardholder before asking for the
  code.
- A card without SMS notifications receives no OTP: ask for another card instead of waiting.
- Store `cardId`, never the card number; keep card numbers, expiries and OTPs out of your logs.
- After a wrong code, re-prompt; after `otp_expired`, `try_new_otp` or `too_many_attempts`, start
  again. Stop prompting after the third wrong code: the fourth blocks the card for about five
  minutes across users, bindings and payments (`card_is_blocked`).

## Saved cards

- Check `card.isActive` before charging, also on the card `confirmPanBinding` returns; offer another
  card when it is `false`.
- After `delete`, `cards.list` and `cards.get` can still return the card for a few seconds: neither
  proves the delete failed. A repeated delete answering `card_not_found` means it is gone.
- `checkPhone` is unreliable on the development gateway (`phone_not_match` for every phone); test it
  on production data before relying on it.
