---
sources:
  - https://developer.paylov.uz/subscribe/payment/transaction-status
---

# Transactions

`getTransactions` reads one transaction by id or lists paid transactions; `getTransactions/rrn`
reads a transaction's RRN where one exists. Vendor contract:
[transaction status](../vendor/paylov/subscribe/payment/transaction-status.md). Grades:
[evidence](README.md#evidence).

## Flow

Every payment flow ends in a transaction with one id ([statuses](#fields-of-transactions)): a
receipt, PWR payment or checkout starts `created`, a hold `waiting`; payment or capture makes it
`payed`; a declined saved-card pay or hold create can make it `failed`; a refund or a hold dismissal
`cancel`, and a hold Paylov released after an expired charge `refunded` (W c087, c113, c135, c187,
c346, c352, c1280, c1526, c1544, c1556).

Reconcile by the [id read](#get-one-transaction), which returns every state; the
[list](#list-transactions) holds only `payed` rows (W c136, c346). REST reads return `account: {}`,
so they cannot rebuild the merchant's order metadata. An [RRN](#get-rrn) exists for saved-card
payments and holds, not for PWR or checkout, and does not prove completion.

## Get one transaction

`GET {BASE_URL}/merchant/getTransactions/?id=<transactionId>`

Reads receipts, PWR, holds and checkout payments in any status, unpaid, refunded and dismissed
included (W c087, c113, c170, c187, c352, c1280, c1526).

| Query | Type | Description                                                                | Grade    |
| ----- | ---- | -------------------------------------------------------------------------- | -------- |
| `id`  | UUID | Non-UUID → `validation_error` `{transactionId: ["Must be a valid UUID."]}` | W (c143) |

Success, a paid saved-card payment (W c089, redacted):

```json
{
  "result": {
    "totalTransaction": 1,
    "transactions": [
      {
        "id": "5eed0000-0000-4000-8000-000000000001",
        "external_id": null,
        "userId": "user-example-1",
        "card_id": "5eed0000-0000-4000-8000-000000000002",
        "cardNumber": "860000******0000",
        "owner": "EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON",
        "amount": 1000.0,
        "amount_in_tiyin": 100000,
        "status": "payed",
        "account": {},
        "cancel_time": null,
        "error_message": null,
        "date": "2026-11-12 20:52:31",
        "is_split": false,
        "is_hold": false,
        "is_a2c": false,
        "transaction_type": "To'lov",
        "via_link": null,
        "ofd": []
      }
    ]
  },
  "error": null
}
```

An unknown `id` is not an error: `{"totalTransaction": 0, "transactions": []}` (W c144). Without
`id` the endpoint lists instead ([list mode](#list-transactions)), so check that the row's `id` is
the requested one.

### Fields of `transactions[]`

Every key is present in every captured row (W c087, c089, c113, c135, c170, c187, c346, c352).

| Field                           | Type            | Description                                                                                                                                                                                                                                                                                                                                                                            | Grade                                                                       |
| ------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`                            | UUID            | Transaction id                                                                                                                                                                                                                                                                                                                                                                         | W                                                                           |
| `external_id`                   | string \| null  | A hold's `externalId`; `null` for receipts and PWR, also when the create body carried `externalId`, `external_id` or `extId`. The docs example shows one on a checkout row; DEV checkouts read `null`, also when the account carried `external_id`, `externalId` and `extId` keys, and no internal-checkout argument carries one                                                       | W (c187, c170, c352, c549, c552, c783, c799, c1400, c1401, c1409, c1411), D |
| `userId`                        | string \| null  | `null` for PWR and checkout; set by `receipts/pay` when create had none                                                                                                                                                                                                                                                                                                                | W (c170, c352, c135)                                                        |
| `card_id`                       | UUID \| null    | `null` until a card is attached; a new id per PWR payment                                                                                                                                                                                                                                                                                                                              | W (c087, c170)                                                              |
| `cardNumber`                    | string \| null  | Masked, `860000******0000`                                                                                                                                                                                                                                                                                                                                                             | W (c089)                                                                    |
| `owner`                         | string \| null  | Abbreviated cardholder name; personal data                                                                                                                                                                                                                                                                                                                                             | W (c089)                                                                    |
| `amount`                        | float           | SUM; read `amount_in_tiyin` instead                                                                                                                                                                                                                                                                                                                                                    | W (c087)                                                                    |
| `amount_in_tiyin`               | int             | Exact; for a captured hold, the captured amount                                                                                                                                                                                                                                                                                                                                        | W (c346)                                                                    |
| `status`                        | string          | Below                                                                                                                                                                                                                                                                                                                                                                                  | W                                                                           |
| `account`                       | object          | `{}` whatever was sent; see [payments](payments.md#common-rules) for where the keys are kept                                                                                                                                                                                                                                                                                           | W (c087, c346, c1152, c1164, c1170)                                         |
| `cancel_time`                   | string \| null  | `YYYY-MM-DD HH:MM:SS`, Tashkent; equals the `payment/cancel` `cancelTime`                                                                                                                                                                                                                                                                                                              | W (c113)                                                                    |
| `error_message`                 | string \| null  | The decline code of a `failed` payment, e.g. `processing_error`; `null` otherwise                                                                                                                                                                                                                                                                                                      | W (c135)                                                                    |
| `date`                          | string          | `YYYY-MM-DD HH:MM:SS`, Tashkent. The creation time while `created` or `waiting`; overwritten with the payment or capture time once `payed`; unchanged by a cancel                                                                                                                                                                                                                      | W (c087→c089, c187→c346, c113)                                              |
| `is_split`, `is_hold`, `is_a2c` | boolean         | Split payment, hold, A2C payout; `is_split` turns `true` once the payment is split and stays `true` after a refund (W c1745, c1749)                                                                                                                                                                                                                                                    | W                                                                           |
| `transaction_type`              | string          | Localized label, `"To'lov"` on every row                                                                                                                                                                                                                                                                                                                                               | W                                                                           |
| `via_link`                      | boolean \| null | `true` for checkout links and internal checkout; `null`, not `false`, otherwise                                                                                                                                                                                                                                                                                                        | W (c352, c089)                                                              |
| `ofd`                           | array           | Fiscal receipts: `receipt_id` (int), `qr_code_url` (the receipt URL of [status](fiscalization.md#get-fiscal-receipt-status)), `date_time` (`YYYY-MM-DD HH:MM:SS`, UTC), `is_refund` (boolean). Empty until a receipt is registered; the sale receipt first, then the refund receipt `payment/cancel` registers ([fixture](../../tests/fixtures/transactions/get.fiscalized.wire.json)) | W (c087, c346, c1631, c1697), D                                             |

The Tashkent zone of `date` ([timestamps](README.md#timestamps-by-operation)): a receipt created at
20:52:19 local time read `20:52:20` (W c086, c087), and a hold captured at `16:00:11` UTC (hold
charge `payedAt`) read `21:00:11` (W c194, c346).

The UTC zone of `ofd[].date_time`: a sale receipt carries the payment time, `06:24:45` for a payment
whose `date` reads `11:24:45` and whose pay request left at 06:24:44.8 UTC, although it was
registered at 06:25:47 UTC; a refund receipt carries the cancel time, `06:28:28` for a `cancel_time`
of `11:28:28` (W c1608, c1629, c1631, c1665, c1697).

| Status                | Meaning                                                                                                                                                                                                                                                                                | Grade                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `created`             | Receipt or checkout not yet paid; PWR not yet confirmed                                                                                                                                                                                                                                | W (c087, c352, c952)          |
| `waiting`             | Uncaptured hold                                                                                                                                                                                                                                                                        | W (c187)                      |
| `payed`               | Paid; a captured hold too                                                                                                                                                                                                                                                              | W (c089, c346)                |
| `failed`              | Declined `receipts/pay`, with `error_message`; also a hold whose create was declined, with `is_hold: true` and `error_message` `processing_error` although create answered `insufficient_funds`                                                                                        | W (c135, c1556)               |
| `cancel`              | Refunded by `payment/cancel`; also a hold released by `hold/dismiss`, before or after expiry, with `cancel_time` set and `is_hold` still `true`                                                                                                                                        | W (c113, c1526, c1544, c1546) |
| `refunded`            | A 1-minute hold Paylov released after expiry, once a charge answered `hold_time_expired`; `cancel_time` is set and `is_hold` stays `true`. An expired hold released by `hold/dismiss` read `cancel` instead, so the release path decides, not expiry. Not observed for a refunded sale | W (c1280, c1544)              |
| `transfer`, `pending` | Documented, never observed                                                                                                                                                                                                                                                             | D                             |

## List transactions

`GET {BASE_URL}/merchant/getTransactions/` without `id`

| Query       | Type         | Description                                                                                                                                 | Grade                      |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `beginDate` | `YYYY-MM-DD` | Anything else, `YYYY-MM-DD HH:MM:SS` included → `field_not_valid` `{"field": "beginDate"}`; today's date includes today's rows; works alone | W (c140, c151, c346, c711) |
| `endDate`   | `YYYY-MM-DD` | Bad format → `field_not_valid` `{"field": "endDate"}`; inclusive; works alone                                                               | W (c152, c703, c712)       |
| `page`      | int ≥ 1      | 0 or `abc` → `validation_error`; past the end → empty `transactions` with the real `totalTransaction`                                       | W (c142, c153, c154)       |

- Only `payed` rows: created, failed and cancelled transactions are excluded, so a refunded payment
  disappears from the list (W c136, c346).
- Merchant-wide; there is no user or status filter. Every other query key is silently ignored, e.g.
  `status`, `userId`, `limit`, `page_size` (W c137–c141, c145–c147, c155, c156).
- Roughly newest `date` first, i.e. by payment time (W c346), but not strictly: in a 98-row read
  across five pages at least one row had a later `date` than the row before it (live run
  2026-11-25).
- `totalTransaction` counts matching rows across all pages (W c153).
- The page size is 20 on DEV: with `totalTransaction` 62, pages 1 to 4 held 20, 20, 20 and 2 rows (W
  c699–c702). Filtered results page the same way (W c709, c710). The docs state no page size.
- The date filter compares the Tashkent calendar date of `date`: rows dated `2026-11-13 04:47:07` to
  `05:23:44`, still 2026-11-12 in UTC, were excluded from `beginDate=endDate=2026-11-12` and
  included in `2026-11-13` (W c703, c704).
- Captured holds (with the captured amount) and checkout payments are listed (W c346). An uncaptured
  `waiting` hold is not: `totalTransaction` stayed unchanged and its id was absent (W c553, c554).

## Get RRN

`GET {BASE_URL}/merchant/getTransactions/rrn/<transactionId>/`

The path parameter is a transaction UUID. Success (W c164):

```json
{
  "result": { "rrn": "000000000000" },
  "error": null
}
```

The RRN is returned for a `receipts/pay` payment, also after it was cancelled (W c164), and for a
hold: already while it is `waiting`, unchanged after the capture and after a refused cancel (W c556,
c558, c562). A paid PWR payment (live run 2026-11-12) and a paid internal-checkout payment (W c589)
have none.

| Trigger                                      | HTTP | Code                                                            | Grade                                                         |
| -------------------------------------------- | ---- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Non-UUID                                     | 400  | `validation_error` `{transactionId: ["Must be a valid UUID."]}` | W (c158)                                                      |
| Unknown                                      | 400  | `transaction_not_found`                                         | W (c165)                                                      |
| Not paid                                     | 400  | `receipt_not_available_for_operation`                           | W (c163)                                                      |
| Paid through the tester-only `payment/` flow | 400  | `transaction_not_available_for_payment`                         | W (c162)                                                      |
| Paid PWR payment                             | 400  | `transaction_not_available_for_payment`                         | Live run 2026-11-12 ([Observed behavior](#observed-behavior)) |
| Paid internal-checkout payment               | 400  | `transaction_not_available_for_payment`                         | W (c589)                                                      |
| No id in the path                            | 404  | `not_found`                                                     | W (c160)                                                      |

## Observed behavior

DEV live run 2026-11-12; no numbered capture.

- List page 1 reported `totalTransaction` 9 and held 9 rows, all `payed`.
- `rrn/` of a paid PWR payment answered `400 transaction_not_available_for_payment`; of a paid
  `receipts/pay` payment, a 12-digit RRN; of an unknown id, `400 transaction_not_found`, consistent
  with W c164, c165.
- `date` of just-paid receipt, PWR and internal-checkout transactions and `cancel_time` of a
  just-cancelled one, decoded as Tashkent time, fell within a minute of the local clock, consistent
  with W c087, c113.

## Deviations from vendor docs

- The page lists `id` as required and documents no list mode; without `id` the endpoint lists paid
  transactions (W c136). The page's `field_required` for a missing `id` and `field_not_valid` for an
  unknown query key do not occur (W c136, c141, c145).
- The page has no field table; its only example is a paid checkout row with a fiscal receipt. The
  table above combines W and D: card fields are `null` before a card is attached, `via_link` is
  `null` outside checkout, and `cancel_time` is a Tashkent time after a refund (W c087, c113).
- The page's example gives `ofd[].date_time` the same value as `date`. Live, `date_time` is UTC and
  `date` Tashkent time, five hours apart (W c1631, c1697).
- The RRN route has no docs page.
- The page's example row echoes `account` as `{"order_id": "12345"}`; REST reads return `{}`
  whatever was sent (W c087, c346).
