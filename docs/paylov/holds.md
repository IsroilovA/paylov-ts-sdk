---
sources:
  - https://developer.paylov.uz/subscribe/hold-payment/create
  - https://developer.paylov.uz/subscribe/hold-payment/charge
  - https://developer.paylov.uz/subscribe/hold-payment/dismiss
  - https://developer.paylov.uz/subscribe/hold-payment/status
---

# Holds

Reserve funds on a bound card, then capture them with **charge** or release them with **dismiss**;
**status** finds a hold by `transactionId` or `externalId`. No OTP step or hold webhook is
documented (D). Vendor contracts: [create](../vendor/paylov/subscribe/hold-payment/create.md),
[charge](../vendor/paylov/subscribe/hold-payment/charge.md),
[dismiss](../vendor/paylov/subscribe/hold-payment/dismiss.md) and
[status](../vendor/paylov/subscribe/hold-payment/status.md). Grades: [evidence](README.md#evidence).
Every success and error is the `{result, error}` envelope, and every failure in the trigger tables
below is HTTP 400 (W c180–c211); a POST to status is 405 ([status](#status)), and a rejected Bearer
token is 401 ([authentication](authentication.md#bearer-failures)). Amounts are whole SUM in both
directions (W c181, c187, c194, c195, c346).

## Flow

The merchant creates a hold against a bound card, then captures it with charge or releases it with
dismiss (D). Hold status reads `hold`, `paid` and `cancelled`; the transaction read of the same id
reads `waiting`, then `payed`, or `cancel` once dismissed, before or after expiry (W c187, c346,
c1526, c1544; [transactions](transactions.md#fields-of-transactions)). A declined create still
leaves a hold record, status `check`, and consumes its `externalId` ([create](#create)).

Charge captures once, possibly partially ([charge](#charge)). Deleting the card does not end its
holds: after [`deleteUserCard/`](cards.md#delete-user-card) an open hold still read `hold`, charged
and dismissed, also 30 seconds after the delete, when `getCard/` already answered `card_not_found`
(W c1901–c1908, c1918–c1926). A captured hold is fiscalized for its captured amount
([register](fiscalization.md#register-fiscal-receipt)). A captured hold can be
[split](splits.md#flow) and [refunded](payments.md#cancel-refund-payment); those pages hold the DEV
results.

Expiry does not release a hold by itself: expired holds keep reading `hold` ([status](#status)); a
charge attempt (`hold_time_expired`) and a [dismiss](#dismiss) were seen to move them to
`cancelled`. The docs state neither when the `time` countdown starts nor the exact moment charge
starts answering `hold_time_expired` (D); captures bound it only coarsely, with a 1-minute hold
refusing charge about 2.5 minutes after create ([observed behavior](#observed-behavior)). A hold's
duration cannot be extended after create, and 28 days is the maximum (Paylov team, 2026-11-25).
After an uncertain create, look the hold up by its `externalId`; a create the client aborted after
sending still ran and read `hold` a second later (W c1581–c1587). A found record or a duplicate-id
error proves only that a record with that `externalId` exists, not that it reserves funds: it may be
released or declined ([create](#create), W c1284, c1285, c1555, c1557).

## Create

`POST {BASE_URL}/merchant/payment/hold/create/`

| Name         | Type   | Required | Rule                                                                | Grade                |
| ------------ | ------ | -------- | ------------------------------------------------------------------- | -------------------- |
| `userId`     | string | Yes      | Merchant-declared user id                                           | W (c180)             |
| `cardId`     | UUID   | Yes      | A card bound to the merchant; unknown or deleted → `card_not_found` | W (c207, c328)       |
| `amount`     | int    | Yes      | SUM, ≥ 10                                                           | W (c181, c187, c204) |
| `time`       | int    | Yes      | Minutes, 1 to 40320 (28 days)                                       | W (c202, c203)       |
| `externalId` | string | No       | ≤ 64 characters, unique per merchant                                | W (c183, c206)       |
| `account`    | object | No       | Merchant data; a string is a `validation_error`; may be omitted     | W (c202, c205)       |
| `serviceId`  | UUID   | No       | Must exist (`service_not_found`); defaults to the merchant id       | W (c184, c208)       |

```json
{
  "userId": "user-1",
  "cardId": "9f877739-bc25-4f0f-a13f-ec485fd04250",
  "amount": 50,
  "time": 30,
  "externalId": "booking-1024"
}
```

Success; `transactionId` identifies the hold for charge, dismiss and status (W c181):

```json
{
  "result": { "transactionId": "d1be13da-4355-4b27-956d-d83b87e013f1" },
  "error": null
}
```

Right after create the hold reads `hold` (W c184), and `getTransactions` reports the transaction as
`waiting` with `is_hold: true` and the `external_id` (W c187).

| Trigger                            | Code                                                                   | `data`                   | Grade                     |
| ---------------------------------- | ---------------------------------------------------------------------- | ------------------------ | ------------------------- |
| Missing required fields            | `validation_error`                                                     | Field map                | W (c180)                  |
| `amount` below 10                  | `validation_error`                                                     | `{"amount": [...]}`      | W (c204)                  |
| `time` 0                           | `validation_error`                                                     | `{"time": [...]}`        | W (c203)                  |
| `time` above 40320                 | `field_not_valid`                                                      | The bare string `"time"` | W (c202)                  |
| `externalId` over 64 characters    | `validation_error`                                                     | `{"externalId": [...]}`  | W (c206)                  |
| Duplicate `externalId`             | `external_id_already_exists`, also after the earlier hold was released | —                        | W (c183, c1270, c1284)    |
| `externalId` of a declined create  | `external_id_already_exists`, also on a card that can hold the amount  | —                        | W (c1554, c1557)          |
| Unknown or deleted card            | `card_not_found`                                                       | —                        | W (c207, c328)            |
| Unknown `serviceId`                | `service_not_found`                                                    | —                        | W (c208)                  |
| The card cannot reserve the amount | `insufficient_funds` "There are insufficient funds on the card."       | —                        | W (c602–c606, c609, c610) |
| `amount` 50 000 000 000 SUM        | `invalid_amount`                                                       | —                        | W (c611)                  |

On DEV the HUMO test card held 10 SUM twice and declined 100 to 1 000 000 000 SUM with
`insufficient_funds` (W c600–c610); these are DEV test balances. The `invalid_amount` bound lies
between 10^9 and 5 × 10^10 SUM (W c606, c611). `external_id_already_exists` proves only that a hold
with that `externalId` exists: after a release the lookup by `externalId` still finds it,
`cancelled` (W c1284, c1285). A declined create consumes its `externalId` too: after create answered
`insufficient_funds`, status by that `externalId` returned a record with status `check`, the
requested `amount`, a `transactionId` and `payedAt` and `cancelTime` `null`; `getTransactions` read
that id `failed` with `is_hold: true` and `error_message` `processing_error`; a new create with the
same `externalId` on the working Uzcard test card answered `external_id_already_exists` (W
c1554–c1557). Retrying a declined hold therefore needs a new `externalId`. `check` is undocumented,
so a decline counts only when the transaction reads `failed`, the status Paylov documents (M
2026-11-25). The create, charge and dismiss pages list no codes; a processing-center decline is one
of the unified decline codes of the [error catalogue](errors.md#funds-and-declines), such as
`insufficient_funds`, `card_expired`, `limit_exceeded` or `do_not_honor` (D, changelog).

## Charge

`POST {BASE_URL}/merchant/payment/hold/charge/`

| Name            | Type | Required | Rule                           | Grade                      |
| --------------- | ---- | -------- | ------------------------------ | -------------------------- |
| `transactionId` | UUID | Yes      | The hold from create           | W (c191)                   |
| `amount`        | int  | Yes      | SUM, 10 ≤ amount ≤ held amount | W (c188, c189, c194, c346) |

Charge works once. A smaller amount is a partial capture: it succeeds, status then reports the
captured amount, and a second charge and a dismiss of the remainder both fail (W c194–c197). The
docs say nothing about the remainder (D); Paylov and the card's bank release it to the cardholder on
their schedule (M 2026-11-15).

Success; `payedAt` is `YYYY-MM-DD HH:MM:SS` in UTC, the same instant `getTransactions` reports in
Tashkent time (W c194, c346):

```json
{
  "result": {
    "transactionId": "d1be13da-4355-4b27-956d-d83b87e013f1",
    "cardId": "9f877739-bc25-4f0f-a13f-ec485fd04250",
    "payedAt": "2026-11-12 16:00:11"
  },
  "error": null
}
```

| Trigger                                   | Code                                                                                                                                                | Grade                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `amount` above the held amount            | `invalid_amount`                                                                                                                                    | W (c188)                                                                                  |
| `amount` below 10, or missing             | `validation_error`                                                                                                                                  | W (c189, c190, c191)                                                                      |
| Unknown transaction                       | `transaction_not_found`                                                                                                                             | W (c192)                                                                                  |
| Not a hold, already charged, or dismissed | `transaction_not_available_for_payment`                                                                                                             | W (c193, c196, c201)                                                                      |
| The card was deleted after create         | None: the charge succeeds, status reads `paid` and the transaction `payed`                                                                          | W (c1903–c1905, c1921–c1923)                                                              |
| Expired hold                              | `hold_time_expired`. The hold then read `cancelled` with a new `cancelTime` and `payedAt: null`, and the transaction `refunded` ([Status](#status)) | D; W (c1276, c1277, c1280); live run 2026-11-12 ([Observed behavior](#observed-behavior)) |

## Dismiss

`POST {BASE_URL}/merchant/payment/hold/dismiss/`

Releases the whole hold; there is no amount field. The docs say the held money then becomes
available on the cardholder's card (D); they say nothing about release after expiry or a partial
capture. Dismiss is therefore the only documented release. A successful dismiss releases the hold,
also after it expires, and `hold_not_found` means nothing is left to release; funds still blocked
after that are Paylov's to resolve (M 2026-11-15).

```json
{ "transactionId": "d1be13da-4355-4b27-956d-d83b87e013f1" }
```

Success (W c198); the response carries no time, status then carries `cancelTime` (W c199):

```json
{
  "result": {
    "transactionId": "d1be13da-4355-4b27-956d-d83b87e013f1",
    "status": "cancelled"
  },
  "error": null
}
```

| Trigger                                                   | Code                                                                                                                                                                                                                                        | Grade                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The card was deleted after create                         | None: the dismiss succeeds, status reads `cancelled` and the transaction `cancel`                                                                                                                                                           | W (c1906–c1908, c1924–c1926)                                                   |
| Already dismissed                                         | `hold_not_found`                                                                                                                                                                                                                            | W (c200)                                                                       |
| After a full or partial charge                            | `hold_not_found`                                                                                                                                                                                                                            | W (c197)                                                                       |
| Expired hold, after a charge answered `hold_time_expired` | `hold_not_found`; status stays `cancelled`                                                                                                                                                                                                  | W (c1276–c1279); live run 2026-11-12 ([Observed behavior](#observed-behavior)) |
| Expired hold, without a charge attempt                    | Success, `status: "cancelled"`, about 150 s and 46.6 minutes after a 1-minute hold was created; status then reads `cancelled` with `cancelTime`, the transaction `cancel` with `cancel_time`, and a second dismiss answers `hold_not_found` | W (c1036, c1037, c1294, c1295, c1543–c1547)                                    |

## Status

`GET {BASE_URL}/merchant/payment/hold/status/?transactionId={id}` or
`GET {BASE_URL}/merchant/payment/hold/status/?externalId={externalId}`. POST is
`405 method_not_allowed` (W c186). Behavior with both parameters is unobserved.

```json
{
  "result": {
    "transactionId": "d1be13da-4355-4b27-956d-d83b87e013f1",
    "status": "paid",
    "payedAt": "2026-11-12 16:00:11",
    "cancelTime": null,
    "amount": 40,
    "serviceId": "5f0c1b8e-9a7d-42a3-8e21-6c0f9b3d47aa"
  },
  "error": null
}
```

| Field           | Type           | Description                                                                       | Grade                      |
| --------------- | -------------- | --------------------------------------------------------------------------------- | -------------------------- |
| `transactionId` | UUID           | Hold transaction id                                                               | W (c184)                   |
| `status`        | string         | See below                                                                         | W (c184, c195, c199)       |
| `payedAt`       | string \| null | `YYYY-MM-DD HH:MM:SS` in UTC once `paid`                                          | W (c195, c338)             |
| `cancelTime`    | string \| null | `YYYY-MM-DD HH:MM:SS` in UTC once `cancelled`                                     | W (c199, c1545)            |
| `amount`        | int            | SUM: the held amount while `hold` or `cancelled`, the captured amount once `paid` | W (c184, c195, c199)       |
| `serviceId`     | UUID           | Always present; the merchant id when none was sent                                | W (c184, c185, c195, c199) |

| Status      | Meaning                                                                                                                                                                                                                                    | Grade                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hold`      | Reserved; chargeable "if hold time have not been expired". An expired hold can still read `hold`: a 1-minute hold read `hold` at 24 polls up to 46.6 minutes after create, and `getTransactions` still read `waiting`                      | W (c184, c417, c458, c506, c535, c612, c717, c781, c817, c841, c892, c910, c916, c922, c926, c928, c947, c956, c958, c992, c1022, c1025, c1028, c1031, c1034, c1035), D; live run 2026-11-12 |
| `paid`      | Charged                                                                                                                                                                                                                                    | W (c195, c338)                                                                                                                                                                               |
| `cancelled` | Dismissed, before or after expiry, or expired and released after a charge answered `hold_time_expired`; expiry alone did not set it during 46.6 minutes of polling                                                                         | W (c199, c1277, c1034, c1545)                                                                                                                                                                |
| `check`     | Read by `externalId` right after a create declined with `insufficient_funds`, with the requested `amount` and both times `null`; the transaction read `failed`. Undocumented: a decline only with that `failed` transaction (M 2026-11-25) | W (c1555, c1556)                                                                                                                                                                             |
| `created`   | Listed without a meaning (D); never observed, not even right after create or during 46 minutes of polling                                                                                                                                  | D                                                                                                                                                                                            |

| Trigger                                 | Code                    | `data` | Grade          |
| --------------------------------------- | ----------------------- | ------ | -------------- |
| Neither parameter                       | `validation_error`      | None   | W (c209)       |
| Unknown `transactionId` or `externalId` | `transaction_not_found` | —      | W (c210, c211) |

## Observed behavior

DEV live run 2026-11-12; no numbered capture.

- Expiry: a hold created with `time: 1` and read about 2.5 minutes later still reported status
  `hold`. Charge then answered `400 hold_time_expired` and dismiss `400 hold_not_found`, the
  sequence W c1274–c1278 records with the reads between them; no `expired` status appeared.
- A partial charge of 400 of 1000 SUM left status `paid` with `amount` 400, and `getTransactions`
  reported the transaction `payed`, consistent with W c194, c195, c346.
- Charge `payedAt` and status `payedAt`/`cancelTime` decoded as UTC fell within a minute of the
  local clock, consistent with W c194, c199.

## Deviations from vendor docs

- Create has two field tables that disagree on `userId`; the gateway requires it (W c180). The
  duplicated `account.additionalProp2` row (en, ru) and the invalid-JSON example comments are
  dropped; the example follows the live request.
- The docs state no minimum for `amount` or `time`; the gateway requires `amount` ≥ 10 on create and
  charge and `time` ≥ 1 (W c189, c203, c204).
- The charge `amount` has no documented unit; it is SUM (W c194, c195, c346). The status `amount`
  example (`10`) is SUM too.
- The docs give no timezone for `payedAt` and `cancelTime`; both are UTC (W c194, c199).
- `serviceId` is documented as "provided by the Payment System"; it is a UUID that must exist and
  defaults to the merchant id, and status always returns it (W c184, c208).
- en and ru describe `transactionId` as "The unique identifier for the user" in the create response
  and the charge tables; it is the hold transaction id (uz agrees).
- The charge and dismiss URLs omit `BASE_URL`; normalized.
- The status page lists `hold_not_found`, `hold_time_expired`, `invalid_amount`, `field_not_valid`,
  `gateway_not_working`, `field_required` and `transaction_not_found` without assigning them to
  operations. Live, an unknown hold is `transaction_not_found` on status and charge, and
  `hold_not_found` comes only from dismiss (W c192, c197, c200, c210, c211).
- The status page lists `paid`, `cancelled`, `hold` and `created`; the gateway also returns the
  undocumented `check` for a declined create (W c1555).
- The sandbox page bundle (S) labels hold amounts "tiyin", sends status as POST and shows mock
  fields (`holdId`, `expiresAt`, statuses `held`, `captured`, `released`). It is not contract.
