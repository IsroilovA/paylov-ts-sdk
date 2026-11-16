# Cards

A bound card's `cardId` is what payments and holds charge. Prefer Card Bind: the cardholder enters
the card on Paylov's page, so the card number never reaches your servers. PAN binding puts your
backend in PCI scope.

## Card Bind

```ts
// 1. Backend: start a session and open bindUrl in a webview.
const link = await paylov.cards.createBindLink({
  userId: 'user-42',
  returnUrl: 'https://app.example/wallet/cards', // close the webview on it
});
await bindSessions.save({ userId: 'user-42', token: link.token, expiresAt: link.expiresAt });

// 2. The card.bind webhook is stored (webhooks.md); a job confirms it with an authenticated read.
const card = await paylov.cards.get({ cardId: bindEvent.cardId });
if (card.userId === bindEvent.userId) await userCards.saveOnce(bindEvent.token, card.cardId);

// 3. No webhook yet: read the session instead.
const session = await paylov.cards.getBindSession({ token: storedBindToken });
if (session.isBound) await userCards.saveOnce(storedBindToken, session.card.cardId);
```

- One link binds one card and expires after about 20 minutes; create one per card.
- Open `bindUrl` exactly as returned; its host differs between environments. It embeds the token:
  keep both out of logs.
- Only the webhook or the session read carries the result, never the webview or `returnUrl`. Paylov
  never retries the webhook, so when it has not arrived, read `getBindSession` after the webview
  closes, then periodically until `expiresAt`.
- Deduplicate on `token`: one bind can reach you through both the webhook and the read.
- Before offering a new link after `link_expired`, compare `cards.list({ userId })` with the cards
  you store: a link that bound a card also reads `link_expired` once it expires. After
  `link_already_used`, never offer a new link.

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
- A card without SMS notifications receives no OTP: offer Card Bind or another card instead of
  waiting.
- A confirmed card can read `isActive: false`, with the reason in `processingStatus`; offer another
  card then.
- `sms` on `startPanBinding`, `startPanPayment` and `confirmPanPayment` is forwarded unchanged;
  Paylov does not document what it changes.
- Store `cardId`, never the card number; keep card numbers, expiries and OTPs out of your logs.
- After a wrong code, re-prompt; after `otp_expired`, `try_new_otp` or `too_many_attempts`, start
  again. Stop prompting after the third wrong code: the fourth blocks the card for about five
  minutes across users, bindings and payments (`card_is_blocked`).

## Saved cards

- Check `card.isActive` before charging; `isSmsEnabled: false` means no OTP can reach the
  cardholder.
- After `delete`, `cards.list` and `cards.get` can still return the card for a few seconds: neither
  proves the delete failed. A repeated delete answering `card_not_found` means it is gone.
- `checkPhone` is unreliable on the development gateway (`phone_not_match` for every phone); test it
  on production data before relying on it.
