---
sources:
  - https://developer.paylov.uz/subscribe/payment/create-transaction
  - https://developer.paylov.uz/subscribe/payment/confirm-payment
  - https://developer.paylov.uz/subscribe/cancel-payment
  - https://developer.paylov.uz/payment-without-registration/create-transaction
  - https://developer.paylov.uz/payment-without-registration/confirm-payment
---

# Payments

Card payments without a hold. Vendor contracts:
[create](../vendor/paylov/subscribe/payment/create-transaction.md),
[pay](../vendor/paylov/subscribe/payment/confirm-payment.md),
[PWR create](../vendor/paylov/payment-without-registration/create-transaction.md),
[PWR confirm](../vendor/paylov/payment-without-registration/confirm-payment.md) and
[cancel](../vendor/paylov/subscribe/cancel-payment.md). Grades: [evidence](README.md#evidence).
Every success and error is the `{result, error}` envelope, and every business and validation failure
is HTTP 400 (W c086, c090–c117).

## Flow

- **Saved card:** create a transaction (`receipts/create`; no money moves), then pay it with a card
  bound through [cards](cards.md) (`receipts/pay`; money moves, no OTP).
- **Payment without registration (PWR):** send a full card number (`paymentWithoutRegistration/`);
  the processing center sends an OTP; confirm it (`confirmPayment/`; money moves). It becomes
  `payed` after confirmation (W c168, c170).
- **Cancel:** fully refund a paid transaction (`payment/cancel/`).

Read and reconcile every result through [transactions](transactions.md); holds are on
[holds](holds.md); the tester-only `payment/` flow is under
[surface outside the SDK](README.md#surface-outside-the-sdk).

A saved-card pay becomes `payed` and sets `date` to the payment time (W c089). A decline leaves one
of two states, even for the same decline code (W), for a reason the docs do not give (D):

- `failed`, with the card attached and `processing_error` in `error_message` (W c134, c135, c630,
  c631). It cannot be paid again: a later pay with either card answers
  `transaction_not_available_for_payment` and it stays `failed` (W c632–c634). Create a new
  transaction instead.
- `created`, with `card_id: null` (W c615, c616). A later pay with another card succeeded, and a
  further pay answered `transaction_already_payed` (W c617–c619).

A pay answered `processing_error` was never seen to end up paid, but Paylov does not document that
it cannot, so the SDK reads it as an unknown outcome and the transaction is read before acting (M
2026-11-25).

After an uncertain pay, read the transaction by id with backoff; a replay error alone does not
establish the earlier outcome ([common rules](#common-rules)). Recovery assumption (M 2026-11-15):
`payed` is done; `transfer`, `pending` and `waiting` are in progress, so keep reading; `failed`
needs a new transaction. A status that stays `created` across backed-off reads means the pay did not
take effect, so pay again with the same `transactionId`; a late first pay then answers
`transaction_already_payed` (W c090) instead of charging twice. A new transaction would risk a
second payment. Consumer steps:
[usage/errors.md](../usage/errors.md#recovery-after-an-ambiguous-failure).

## Common rules

Wire units: [amount units](README.md#amount-units-by-operation).

- Unknown request fields are ignored; numeric strings are coerced (W c095).
- `account` must be a JSON object wherever accepted; a string is `validation_error`
  `{"account": ["Input should be a valid dictionary"]}` (W c093, c173). REST reads return
  `account: {}` whatever was sent (W c087, c346), although Paylov keeps the keys: for a receipt and
  a PWR payment the GraphQL `getCheck` read returns every sent key in `account`, with `accountData`
  `"[]"` (W c1151–c1153, c1166–c1171). Callbacks carry the keys sent ([callbacks](callbacks.md)).
- No request takes an idempotency key: each create call makes a new transaction (W c095, c100). Two
  identical `receipts/create` or PWR bodies with an `Idempotency-Key` header and `externalId`,
  `external_id` and `extId` fields made two transactions, and neither stored an external id
  (`external_id` reads `null`) (W c547–c552). Replays of the money-moving calls answer with a state
  code (below), which does not prove an earlier success: a cancel of a receipt that was never paid
  answers the same `transaction_not_available_for_cancel` as a repeated cancel, and the receipt
  stays `created` (W c112, c1271–c1273); a repeated PWR confirm answers `otp_expired` like a
  genuinely expired OTP (W c169, c789). Confirm every replay with a
  [transaction read](transactions.md#get-one-transaction).

## Create payment transaction

`POST {BASE_URL}/merchant/receipts/create/`

| Name      | Type   | Required | Description                             | Grade          |
| --------- | ------ | -------- | --------------------------------------- | -------------- |
| `amount`  | int    | Yes      | Whole SUM, 1 to at least 10 000 000 000 | W (c096–c103)  |
| `account` | object | Yes      | Merchant data; `{}` when none           | W (c091, c092) |
| `userId`  | string | No       | When absent, `receipts/pay` sets it     | W (c100, c135) |

```json
{
  "userId": "user-42",
  "amount": 1000,
  "account": { "order_id": "A-1024" }
}
```

Success: no money moves; the transaction reads `created` with null card fields (W c086, c087).

```json
{
  "result": { "transactionId": "5eed0000-0000-4000-8000-000000000001" },
  "error": null
}
```

| Trigger                                    | Code               | `data`                            | Grade          |
| ------------------------------------------ | ------------------ | --------------------------------- | -------------- |
| `{}`                                       | `validation_error` | `{amount: [...], account: [...]}` | W (c091)       |
| `account` missing or a string              | `validation_error` | `{account: [...]}`                | W (c092, c093) |
| `amount` not an integer, or a fraction     | `validation_error` | `{amount: [...]}`                 | W (c094, c099) |
| `amount` 0, negative, or `999999999999999` | `field_not_valid`  | `{"field": "amount"}`             | W (c096–c098)  |

## Pay with a saved card

`POST {BASE_URL}/merchant/receipts/pay/`

Charges the card for the amount fixed at create. No OTP.

| Name            | Type   | Required | Description                                        | Grade          |
| --------------- | ------ | -------- | -------------------------------------------------- | -------------- |
| `transactionId` | UUID   | Yes      | From `receipts/create`                             | W (c105, c107) |
| `cardId`        | UUID   | Yes      | A card bound to `userId`                           | W (c108, c109) |
| `userId`        | string | Yes      | Missing → `field_required`, not `validation_error` | W (c110)       |

Success echoes `{"transactionId": ...}` (W c088); decline states and recovery are under
[flow](#flow).

On DEV the HUMO test card paid 1, 2, 5 and 20 SUM and declined 50 and 1000 SUM with
`insufficient_funds` (W c570–c585, c615, c623–c630); these are DEV test balances.

| Trigger                           | Code                                                                                                                 | Grade                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Already paid (replay)             | `transaction_already_payed`                                                                                          | W (c090)                |
| Cancelled or `failed` transaction | `transaction_not_available_for_payment`                                                                              | W (c118, c632)          |
| Unknown `transactionId`           | `transaction_not_found`                                                                                              | W (c106)                |
| Non-UUID `transactionId`          | `validation_error` `{transactionId: ["must be a valid UUID"]}`                                                       | W (c107)                |
| Unknown `cardId`                  | `card_not_found`                                                                                                     | W (c108)                |
| Deleted `cardId`; stays `created` | `card_not_found`                                                                                                     | W (c1909, c1910, c1927) |
| Card of another `userId`          | `card_is_not_for_this_check`                                                                                         | W (c109)                |
| No `userId`                       | `field_required`, message `field_required: userId`, no `data`                                                        | W (c110)                |
| Processing decline                | `processing_error`, or an issuer code such as `insufficient_funds`, `card_expired`, `do_not_honor`, `limit_exceeded` | W (c134, c615, c630); D |

## Payment without registration

`POST {BASE_URL}/merchant/paymentWithoutRegistration/`

A one-off payment by full card number. No money moves until the OTP is confirmed.

| Name         | Type   | Required | Description                                                                                                                                                                                                                                                                          | Grade                       |
| ------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `cardNumber` | string | Yes      | Full PAN; a bad Luhn digit → `card_not_found`. Minimum length untested here; [card binding](cards.md#create-user-card) requires 16 characters                                                                                                                                        | W (c176)                    |
| `expireDate` | string | Yes      | `YYMM` with month 01–12; `MMYY` → `validation_error`; a valid but wrong expiry → `card_not_found`                                                                                                                                                                                    | W (c174, c175)              |
| `amount`     | int    | Yes      | Whole SUM, at least 1: 1 SUM was created and confirmed; 0 → `invalid_amount`                                                                                                                                                                                                         | W (c177, c590, c593)        |
| `account`    | object | Yes      | Merchant data; `{}` when none                                                                                                                                                                                                                                                        | W (c171, c172)              |
| `extId`      | string | No       | At most 64 characters, else `validation_error` "String should have at most 64 characters"; echoed in the response in full, never stored (`external_id` reads `null`)                                                                                                                 | W (c166, c170, c594–c599)   |
| `sms`        | object | No       | Undocumented here. `{hash?: string, templateId?: int}` as on [card binding](cards.md#create-user-card): omitted, `{}` and `{hash, templateId: 1}` completed alike, a string is `validation_error`; its effect is undocumented and none was observed; the SDK does not send the field | W (c737, c739, c1365–c1373) |

```json
{
  "cardNumber": "<full PAN>",
  "expireDate": "2911",
  "amount": 1200,
  "account": {}
}
```

```json
{
  "result": {
    "transactionId": "5eed0000-0000-4000-8000-000000000005",
    "otpSentPhone": "+9989*****00",
    "extId": null,
    "code": null
  },
  "error": null
}
```

- OTP delivery and the `otpSentPhone` mask follow [card binding](cards.md#create-user-card) (W c166,
  c178; D shows `********6466`).
- `code` is undocumented and `null` in every capture, with or without `sms` (W c166, c178, c1365,
  c1368, c1371).
- After confirmation the transaction has `userId: null` and a new `card_id` per payment, distinct
  from a saved card with the same PAN (W c170, c346).

| Trigger                       | Code                                                                                           | Grade          |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | -------------- |
| `{}`                          | `validation_error` `{cardNumber, expireDate, amount, account: [...]}`                          | W (c171)       |
| `account` missing or a string | `validation_error` `{account: [...]}`                                                          | W (c172, c173) |
| `MMYY` expiry                 | `validation_error` `{expireDate: ["expireDate must be YYMM format with valid month (01-12)"]}` | W (c174)       |
| Wrong expiry, bad Luhn        | `card_not_found`                                                                               | W (c175, c176) |
| `amount` 0                    | `invalid_amount`                                                                               | W (c177)       |

## Confirm payment without registration

`POST {BASE_URL}/merchant/confirmPayment/`

| Name            | Type   | Required | Description                                                                                                                                                                                   | Grade                         |
| --------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `transactionId` | UUID   | Yes      | From `paymentWithoutRegistration/`                                                                                                                                                            | W (c128)                      |
| `otp`           | string | Yes      | The 6-digit code from the SMS                                                                                                                                                                 | W (c168), D                   |
| `sms`           | object | No       | Undocumented here. As on create: `{}` and `{hash, templateId: 1}` accepted, a string is `validation_error`; its effect is undocumented and none was observed; the SDK does not send the field | W (c738, c1363, c1369, c1372) |

Success is `{"result": {"transactionId": ...}, "error": null}` and the transaction becomes `payed`
(W c168, c170, c179).

On DEV the OTP lives about 90 s from the create response, as on
[card binding](cards.md#otp-behavior): confirm worked at 60.7, 76.8 and 85.6 s and returned
`otp_expired` at 90.5 s and 5 minutes (W c785, c842, c846, c789, c521). The attempt limit also
matches: the 4th wrong OTP blocks the card for about 300 s. The count is per flow: during a block
caused by card binding, PWR confirm still answered `invalid_otp` three times before
`card_is_blocked` (W c944–c948). The correct OTP is then refused and the transaction stays `created`
(W c951, c952).

| Trigger                                                                               | Code                                                     | Grade                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------- |
| Wrong OTP, up to the 3rd in a row; the right OTP still succeeds afterwards            | `invalid_otp`                                            | W (c167, c168, c944–c946) |
| The 4th wrong OTP, and any OTP during the block; `data` `{"sec_to_retry": <seconds>}` | `card_is_blocked`                                        | W (c948, c951)            |
| OTP lifetime elapsed                                                                  | `otp_expired`                                            | W (c789)                  |
| The correct OTP again after success                                                   | `otp_expired`, the same code as a genuinely expired OTP  | W (c169)                  |
| Decline                                                                               | `insufficient_funds`, repeatable on the same transaction | W (c127, c131–c133)       |
| Unknown transaction                                                                   | `transaction_not_found`                                  | W (c129)                  |
| `{}`                                                                                  | `validation_error` `{transactionId: [...]}`              | W (c128)                  |

## Cancel (refund) payment

`POST {BASE_URL}/merchant/payment/cancel/`

Fully refunds a paid transaction; there is no amount field and no partial refund. Cancelling a card
payment also cancels its [fiscal receipt](fiscalization.md#refund-fiscal-receipt) (D); live, the
refund receipt follows seconds to minutes after the cancel (W c1666, c1689, c1691). Release an
uncaptured hold with [dismiss](holds.md#dismiss) instead.

The API refunds saved-card and PWR payments and captured holds, per the Paylov team (answer relayed
by the maintainer, 2026-11-25: "Refunds of both are possible. Refunds of holds are possible too",
translated from Russian; captured holds confirmed again in an answer relayed 2026-11-26); the docs
do not say which kinds it refunds (D). How a refunded captured hold reads in
[`getTransactions`](transactions.md#get-one-transaction) is unobserved. DEV refunded only saved-card
payments: a fully captured hold answered `processing_error` twice, 10 minutes apart, and stayed
`payed` (W c557, c559, c560, c887, c888); a [split](splits.md#flow) captured hold answered
`processing_error`, then `transaction_not_available_for_cancel` about 10 minutes later, and stayed
`payed` (W c1979, c1980, c2008, c2009); a confirmed PWR payment (W c564–c566) and a paid checkout (W
c358) answered `transaction_not_available_for_cancel` and stayed `payed`. Saved-card payments also
have an unknown API refund cut-off: two paid on 2026-11-13, about 11 days old, answered
`transaction_not_available_for_cancel` and stayed `payed` (W c1562–c1564, c1566–c1568), while a
same-day saved-card payment refunded (W c1579, c1580); the cut-off is agreed with each merchant, per
the Paylov team (answer relayed by the maintainer, 2026-11-25: "agreed with each one separately",
translated from Russian). The sandbox API Reference describes the cancel as "Cancel a payment that
hasn't been settled yet" (S), which suggests the cut-off is the merchant settlement; neither the DEV
window nor the production one is known. Production was not tried. The other documented cancel paths
are the Paylov business panel and Paylov staff, which emit
[`transaction.cancel`](callbacks.md#transactioncancel) (D); whether an API cancel emits it is
undocumented, so confirm a refund with a [transaction read](transactions.md#get-one-transaction).

| Name            | Type | Required | Description | Grade          |
| --------------- | ---- | -------- | ----------- | -------------- |
| `transactionId` | UUID | Yes      |             | W (c116, c117) |

Success; `cancelTime` is `YYYY-MM-DD HH:MM:SS` in Tashkent time, UTC+05:00: the request left at
20:54:06 Tashkent time (W c111, c119):

```json
{
  "result": {
    "transactionId": "5eed0000-0000-4000-8000-000000000001",
    "status": "cancelled",
    "cancelTime": "2026-11-12 20:54:08"
  },
  "error": null
}
```

The transaction then reads `status: "cancel"` with the same `cancel_time`, and unchanged `date` and
`amount_in_tiyin` (W c113; [fields](transactions.md#fields-of-transactions)).

A [split](splits.md) payment refunds the same way: the parent reads `cancel` with `is_split: true`,
every share reads `cancelled`, and a fiscalized split gets its refund receipt seconds later (W
c1746–c1749, c1810–c1813).

| Trigger                                                                                                                   | Code                                                           | Grade                               |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| Already cancelled (replay)                                                                                                | `transaction_not_available_for_cancel`                         | W (c112)                            |
| Not paid (`created`); the receipt stays `created`                                                                         | `transaction_not_available_for_cancel`                         | W (c114, c1272, c1273)              |
| Checkout transaction (`via_link: true`)                                                                                   | `transaction_not_available_for_cancel`                         | W (c358)                            |
| Paid PWR payment                                                                                                          | `transaction_not_available_for_cancel`                         | W (c565)                            |
| Saved-card payment about 11 days old                                                                                      | `transaction_not_available_for_cancel`; it stays `payed`       | W (c1563, c1567)                    |
| Fiscalized saved-card payment whose register first failed with `ofd_error` three times, 1.5 and 7.5 minutes after payment | `transaction_not_available_for_cancel`; it stays `payed`       | W (c1633, c1698)                    |
| Unfiscalized, unsplit saved-card payment 3.7 minutes after payment                                                        | `transaction_not_available_for_cancel`; it stays `payed`       | W (c1831, c1834)                    |
| Captured hold, on DEV, also fiscalized or partly captured; it stays `payed`                                               | `processing_error`                                             | W (c559, c887, c1863, c1864, c1877) |
| Captured hold whose card was deleted before the capture, on DEV                                                           | `transaction_not_available_for_cancel`                         | W (c1911, c1929)                    |
| Unknown                                                                                                                   | `transaction_not_found`                                        | W (c115)                            |
| Non-UUID                                                                                                                  | `validation_error` `{transactionId: ["must be a valid UUID"]}` | W (c116)                            |
| Not permitted for the merchant                                                                                            | `permission_denied`                                            | D                                   |

## Observed behavior

DEV live run 2026-11-12; no numbered capture.

- `payment/cancel` `cancelTime`, decoded as Tashkent time, fell within a minute of the local clock,
  consistent with W c111.
- A repeated `receipts/pay` answered `transaction_already_payed`, and a repeated cancel and a cancel
  of a paid internal-checkout transaction `transaction_not_available_for_cancel`, consistent with W
  c090, c112, c358.
- A PWR payment of 1200 SUM, confirmed with the test card's OTP, read back `payed` with
  `amount_in_tiyin` 120000.

## Deviations from vendor docs

- `receipts/create` response-shape discrepancy: [errors](errors.md#deviations-from-vendor-docs) (W
  c086).
- `receipts/pay`: the page lists no codes. `payment/cancel`: the page lists only
  `permission_denied`, `transaction_not_found` and `transaction_not_available_for_cancel`. The
  tables above are W.
- The PWR pages do not document `sms`; the gateway validates it on create and confirm (W c739,
  c1363).
- `paymentWithoutRegistration/`: the page marks `account` optional; the gateway requires it (W c171,
  c172). The response also carries `code` (W c166).
- `confirmPayment/`: the page's success adds `"status": "success"`; the gateway omits it (W c168).
- The cancel request example's trailing `// example this transactionId` comment (en, ru) is removed;
  JSON allows no comments.
