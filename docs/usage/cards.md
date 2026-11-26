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
  again. Stop prompting after the third wrong code: the fourth answers `card_is_blocked` and blocks
  binding of that card, also for another user, for about five minutes on Paylov's test environment.
  A card-number payment counts its own wrong codes: during that block its confirm still answered
  `invalid_otp` three times before `card_is_blocked`.
- While the OTP is valid, starting the binding again answers `otp_code_already_sent`; after it
  expires, about 90 seconds on Paylov's test environment, a new start returns the same `cardId` with
  a new OTP. You can delete a pending binding, but the resend cooldown still applies. A start after
  the cooldown returns a new `cardId` if the old binding was deleted.

### Recover an unanswered confirm

Keep the `cardId` from `startPanBinding` and call `cards.get({ cardId })` after the binding
session's deadline. A returned card confirms the binding. Check `isActive` separately before
charging. On Paylov's test environment an unconfirmed binding answers HTTP 400 `card_not_found`,
including after a wrong OTP or after expiry. `cards.list({ userId })` omits unconfirmed bindings and
can still omit a newly confirmed card while serving a cached list. On DEV, `cards.get` saw the
confirmed card immediately even when `cards.list` still returned its cached empty result.

## Saved cards

- Check `card.isActive` before charging, also on the card `confirmPanBinding` returns; offer another
  card when it is `false`.
- After `delete`, `cards.list` and `cards.get` can still return the card for a few seconds: neither
  proves the delete failed. A repeated delete answering `card_not_found` means it is gone.
- `checkPhone` is unreliable on the development gateway (`phone_not_match` for every phone); test it
  on production data before relying on it.
