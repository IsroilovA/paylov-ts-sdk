---
sources:
  - https://developer.paylov.uz/subscribe/ofd/register
  - https://developer.paylov.uz/subscribe/ofd/get-receipt
  - https://developer.paylov.uz/subscribe/ofd/set-receipt
  - https://developer.paylov.uz/subscribe/ofd/refund-receipt
  - https://developer.paylov.uz/subscribe/ofd/activity-type
---

# Fiscalization (OFD)

Fiscal receipts in the Uzbek fiscal system (OFD) for a transaction, and tax-service activity-type
checks. No money moves here. Grades: [evidence](README.md#evidence).

## Flow

- **Register:** the merchant has Paylov send a card transaction (by `transactionId`) or a cash
  payment (by `externalId` and `phoneNumber`) with its [items](#item-object) to OFD
  ([register](#register-fiscal-receipt), D).
- **Set receipt:** the merchant fiscalizes itself and attaches the receipt
  ([set receipt](#set-fiscal-receipt)); this needs client-side fiscalization, otherwise
  `permission_denied` (D). The mode is merchant setup agreed with Paylov (M 2026-11-15).
- **Read:** [status](#get-fiscal-receipt-status) by transaction or receipt id. A known transaction
  without a receipt returns `success: false`, which does not mean the payment failed; unknown ids
  return errors (W c274, c866, c1308).
- **Refund:** cancel a fiscalized card payment with
  [`payment/cancel`](payments.md#cancel-refund-payment), which also cancels its fiscalization, then
  read the refund receipt; the [direct refund](#refund-fiscal-receipt) is for when status shows none
  (D).

Which payments Paylov fiscalizes itself is [OPEN Q32]: no page states automatic fiscalization (D),
and a paid payment of the DEV merchant, which has no fiscalization, has an empty `ofd` array (W
c125, c1300). An item line totals `(price - discount) * count` ([items](#item-object), M
2026-11-16). [Activity types](#activity-types) are independent of receipts.

Validation runs before the permission gate (W c269, c270 versus c271; c1310 versus c1301). Register,
set-receipt, refund and activity types answer `400 permission_denied` without `data` for a merchant
without fiscalization (W c271, c277, c279, c283, c1301–c1304). Status is not gated: it answered
`200` for the same merchant (W c274, c1305).

## Register fiscal receipt

`POST {BASE_URL}/merchant/fiscalization/register/`

Sends a card or cash transaction to the OFD to generate a fiscal receipt. The identifying field
depends on the payment type.

| Name            | Type                           | Required     | Description                               | Grade    |
| --------------- | ------------------------------ | ------------ | ----------------------------------------- | -------- |
| `transactionId` | string (UUID)                  | Card payment | Transaction ID.                           | D        |
| `externalId`    | string                         | Cash payment | Unique identifier for the fiscal receipt. | D        |
| `phoneNumber`   | string                         | Cash payment | Client phone, `+998*******`.              | D        |
| `items`         | array of [items](#item-object) | Yes          | Receipt items.                            | W (c269) |

The validator requires only `items`: `{}` reports `items` alone (W c269), and a card payment without
`phoneNumber` passes validation (W c271). Which identifier wins when both are sent is undocumented;
both together still reached the permission gate (W c1309).

### Item object

Split payments use the same item object ([splits.md](splits.md)).

| Name           | Type    | Required | Description                                                                          | Grade                                 |
| -------------- | ------- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `title`        | string  | Yes      | Item name.                                                                           | W (c270)                              |
| `price`        | integer | Yes      | Pre-discount price of one unit ([unit](README.md#amount-units-by-operation)).        | W (c270) required; D unit; M per unit |
| `discount`     | integer | No       | Discount on one unit ([unit](README.md#amount-units-by-operation)), at most `price`. | W (c270) optional; M unit; M per unit |
| `count`        | integer | Yes      | Quantity, at least 1.                                                                | W (c270, c272)                        |
| `code`         | string  | Yes      | Unique item code (IKPU).                                                             | W (c270)                              |
| `vat_percent`  | integer | Yes      | VAT percentage.                                                                      | W (c270)                              |
| `package_code` | string  | Yes      | Package type code.                                                                   | W (c270)                              |
| `pinfl`        | string  | One of   | Individual taxpayer number, 14 digits.                                               | D, W (c886)                           |
| `tin`          | string  | One of   | Taxpayer identification number (INN), 9 digits.                                      | D, W (c886)                           |

The [vendor item table](../vendor/paylov/subscribe/ofd/register.md#item-object-inside-items) gives
no `discount` unit, only that it "Cannot exceed the price" (D, all locales); a comparison with the
tiyin `price` holds only in tiyin, so `discount` is tiyin (M 2026-11-15).

No page states how items total for the `invalid_amount` check ("The total price of items does not
match the transaction amount", D), and DEV rejects register for the merchant (W c271), so no total
was observed. The table describes "the item" with a `count` "Quantity of the item", and caps the
discount at "the price", so `price` is the unit price and `discount` applies per unit: a line totals
`(price - discount) * count`, and the lines sum to the transaction amount (M 2026-11-16).

Each item carries exactly one of `pinfl` and `tin` (D). An otherwise valid item with neither got
`validation_error`
`{"items": {"0": {"non_field_errors": ["Either 'pinfl' or 'tin' must be provided."]}}}`, and the
same item with `tin` reached the permission gate (W c886, c890); items with field errors did not
report it (W c270, c272). An item with `tin: "12"` and `pinfl: "1"` together drew only its `count`
error (W c272), so the validator does not check tax-id formats; a later business check may. ru names
the `title` field `титул` in its table; every example uses `title`.

Request (the vendor card-payment example without the undocumented fields; see Deviations):

```json
{
  "transactionId": "string",
  "externalId": "string",
  "phoneNumber": "string",
  "items": [
    {
      "title": "string",
      "price": 0,
      "discount": 0,
      "count": 1,
      "code": "string",
      "vat_percent": 0,
      "package_code": "string",
      "pinfl": "string",
      "tin": "string"
    }
  ]
}
```

Success, D ([fixture](../../tests/fixtures/fiscalization/register.success.docs.json)):

```json
{
  "result": {
    "ofd": {
      "receiptUrl": "https://ofd.example.com/receipt/12345",
      "terminalId": "T123456",
      "receiptId": 987654,
      "fiscalSign": "FS123ABC"
    }
  }
}
```

| Field            | Type    | Description       |
| ---------------- | ------- | ----------------- |
| `ofd.receiptUrl` | string  | Receipt URL.      |
| `ofd.terminalId` | string  | Terminal ID.      |
| `ofd.receiptId`  | integer | Receipt ID.       |
| `ofd.fiscalSign` | string  | Fiscal signature. |

| Code                                        | Description                                                                                                                                                                                                                                                 | Grade                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `validation_error`                          | `{}` gives `{"items": [...]}`; item errors use an index map `{"items": {"0": {"title": [...], ...}}}` ([fixture](../../tests/fixtures/fiscalization/register.nestedValidation.wire.json))                                                                   | W (c269, c270, c272) |
| `permission_denied`                         | Fiscalization is not enabled for the merchant                                                                                                                                                                                                               | W (c271)             |
| `receipt_not_available_for_operation`       | The transaction is not eligible for a fiscal receipt.                                                                                                                                                                                                       | D                    |
| `field_required`                            | Required field missing (e.g. `items`).                                                                                                                                                                                                                      | D                    |
| `ofd_check_already_generated`               | The transaction already has a fiscal receipt.                                                                                                                                                                                                               | D                    |
| `ofd_commitent_or_subcommission_not_active` | An item's commitent (TIN) or sub-commission (PINFL) has no active contract in the OFD catalogue; `data`: `itemIndex`, `tin`, `pinfl` ([fixture](../../tests/fixtures/fiscalization/register.commitentNotActive.docs.json), built from the catalogue entry). | D                    |
| `invalid_amount`                            | The items' total does not match the transaction amount.                                                                                                                                                                                                     | D                    |
| `ofd_error`                                 | OFD processing failed.                                                                                                                                                                                                                                      | D                    |
| `fiscal_receipt_not_generated`              | The receipt was not generated.                                                                                                                                                                                                                              | D                    |

## Get fiscal receipt status

`GET {BASE_URL}/merchant/fiscalization/status/`

| Query           | Type          | Required | Description                                                                                                                                                                                                                         | Grade                    |
| --------------- | ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `transactionId` | string (UUID) | One of   | Transaction ID.                                                                                                                                                                                                                     | D, W (c274)              |
| `externalId`    | string        | One of   | Receipt identifier from cash-payment registration.                                                                                                                                                                                  | D                        |
| `refunded`      | boolean       | No       | Filter by refund status. A paid transaction without a receipt answers the no-receipt shape with `refunded=false`, `true` or the filter omitted; which receipt an omitted filter returns for a refunded transaction is undocumented. | D, W (c274, c1305–c1307) |

The page requires either identifier and does not say whether both are allowed; live, both together
answer for `transactionId` (W c878).

```http
GET {BASE_URL}/merchant/fiscalization/status/?refunded=false&transactionId=e2da46c6-8c89-400e-8bd9-037297b2e8b1
```

A receipt, D ([fixture](../../tests/fixtures/fiscalization/getReceipt.success.docs.json)):

```json
{
  "result": {
    "success": true,
    "isRefund": false,
    "receiptUrl": "https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001",
    "terminalId": "EP000000000378",
    "receiptId": 173723,
    "fiscalSign": "947030008479"
  }
}
```

No receipt, W (c274, [fixture](../../tests/fixtures/fiscalization/getReceipt.noReceipt.wire.json)):
a paid card payment of a merchant without fiscalization, about 10 minutes after payment.
`terminalId`, `receiptId` and `fiscalSign` are absent:

```json
{
  "result": { "success": false, "receiptUrl": null, "isRefund": null },
  "error": null
}
```

`success` reports whether a receipt was found and `isRefund` whether it is a refund receipt; the
other fields match register. That shape belongs to a known transaction, also given as an upper-case
UUID or as a captured hold's id (W c859, c861). An unknown `transactionId` is
`400 transaction_not_found` (W c1308; live run 2026-11-12), and one that is not a UUID (letters, SQL
text, a path, `%00`, Cyrillic, 5000 characters, empty) is `validation_error` (W c849–c853, c856,
c863). Every unknown `externalId` is `400 ofd_check_not_found`: spaces, `&` and `=`, HTML, Cyrillic,
SQL text, 1000 and 2000 characters, and a hold's `externalId` (W c866–c869, c873, c874, c876). A
5000-character `externalId` made the gateway close the HTTP/2 session without any HTTP response,
twice (W c870, c872). No other merchant's transaction id was available, so that answer is
unobserved.

| Code                    | Description                                                                                                                                                          | Grade                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `validation_error`      | Neither identifier, or an empty `externalId`; `data` is the bare string `"transactionId or externalId is required"`                                                  | W (c273, c875)                                                                |
| `validation_error`      | `transactionId` not a UUID; `data` `{"transactionId": ["transactionId must be a valid UUID"]}`                                                                       | W (c849, c863)                                                                |
| `transaction_not_found` | Unknown `transactionId` ([synthesized fixture](../../tests/fixtures/fiscalization/getReceipt.transactionNotFound.synthesized.json); the capture redacts the message) | W (c1308); live run 2026-11-12 ([Observed behavior](#observed-behavior))      |
| `ofd_check_not_found`   | Unknown `externalId`, message "Ofd check not found." ([synthesized fixture](../../tests/fixtures/fiscalization/getReceipt.checkNotFound.synthesized.json))           | W (c866, c876); live run 2026-11-12 ([Observed behavior](#observed-behavior)) |
| No HTTP response        | A 5000-character `externalId`: the HTTP/2 session closes                                                                                                             | W (c870, c872)                                                                |
| `method_not_allowed`    | `POST` instead of `GET`                                                                                                                                              | W (c275)                                                                      |

## Set fiscal receipt

`POST {BASE_URL}/merchant/fiscalization/set-receipt/`

Attaches a receipt the merchant fiscalized itself to a successfully paid transaction; Paylov
generates and sends no OFD receipt. The merchant needs the fiscalization API in client-side mode (ru
and uz name it `CLIENT_SIDE`).

| Name            | Type          | Required | Description                                       | Grade                       |
| --------------- | ------------- | -------- | ------------------------------------------------- | --------------------------- |
| `transactionId` | string (UUID) | Yes      | A successfully paid transaction of this merchant. | W (c278)                    |
| `externalId`    | string        | No       | Unique external receipt identifier.               | D                           |
| `terminalId`    | string        | Yes      | OFD terminal ID, at most 32 characters.           | W (c278) required; D length |
| `dateTime`      | string        | Yes      | Receipt date and time, `YYYYMMDDHHMMSS`.          | W (c278) required; D format |
| `fiscalSign`    | string        | Yes      | Fiscal signature, at most 64 characters.          | W (c278) required; D length |
| `qrCodeUrl`     | string        | Yes      | Receipt URL, HTTPS on `ofd.soliq.uz`.             | W (c278) required; D format |
| `receiptId`     | integer       | Yes      | OFD receipt ID, greater than 0.                   | W (c278, c280)              |

The documented `dateTime` and `qrCodeUrl` constraints are not enforced before the permission gate:
`"2026-11-12"` and `http://example.com` passed validation (W c280). The vendor request example is
the [request fixture](../../tests/fixtures/fiscalization/attachReceipt.request.docs.json).

Success, D ([fixture](../../tests/fixtures/fiscalization/attachReceipt.success.docs.json)); the
nested `result.error` is part of the documented shape:

```json
{
  "result": {
    "success": true,
    "error": null
  }
}
```

| Code                                     | Description                                                                                                               | Grade          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `validation_error`                       | A required field is missing (`{}` lists the six required fields), or `receiptId` is 0 ("Input should be greater than 0"). | W (c278, c280) |
| `permission_denied`                      | Fiscalization is disabled, or the merchant does not use client-side fiscalization.                                        | W (c279), D    |
| `field_not_valid`                        | `transactionId`, `dateTime` or `qrCodeUrl` has an invalid format; `data.field` names it.                                  | D              |
| `external_id_already_exists`             | A receipt with this `externalId` already exists.                                                                          | D              |
| `transaction_not_found`                  | The transaction does not exist or belongs to another merchant.                                                            | D              |
| `receipt_not_available_for_operation`    | The transaction has not been successfully paid.                                                                           | D              |
| `ofd_check_already_generated`            | A receipt is already attached to the transaction.                                                                         | D              |
| `ofd_too_many_requests_for_this_receipt` | Too many receipt attempts exist for the transaction ([threshold](errors.md#deviations-from-vendor-docs)).                 | D              |

## Refund fiscal receipt

`POST {BASE_URL}/merchant/fiscalization/refund/`

Generates an OFD refund receipt for a registered receipt; it moves no money. For a fiscalized card
payment, cancel the transaction with [`payment/cancel`](payments.md#cancel-refund-payment) instead;
that also cancels its fiscalization. Call refund directly only when refund fiscalization is not
otherwise available via `/fiscalization/status/` (D).

`receiptId` (integer, required, W c276) is the receipt ID from register or status:

```json
{
  "receiptId": 184595
}
```

Success, D ([fixture](../../tests/fixtures/fiscalization/refundReceipt.success.docs.json));
`ofd.refund` is the new refund receipt and `sale` the original, whose `receiptId` matches the
request:

```json
{
  "result": {
    "ofd": {
      "refund": {
        "receiptUrl": "https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001",
        "terminalId": "EP000000000378",
        "receiptId": 184636,
        "fiscalSign": "583109124612"
      }
    },
    "sale": {
      "receiptUrl": "https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001",
      "terminalId": "EP000000000378",
      "receiptId": 184595,
      "fiscalSign": "290464420473"
    }
  }
}
```

| Code                | Description                                   | Grade    |
| ------------------- | --------------------------------------------- | -------- |
| `validation_error`  | `receiptId` missing                           | W (c276) |
| `permission_denied` | Fiscalization is not enabled for the merchant | W (c277) |

The [refund page](../vendor/paylov/subscribe/ofd/refund-receipt.md) documents no business error
codes (D).

## Activity types

`POST {BASE_URL}/merchant/fiscalization/activity-types/`

Asks the tax service whether the person with a PINFL has an activity type.

| Name           | Type    | Required | Description                                                                                                                                                                  | Grade             |
| -------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `pinfl`        | string  | Yes      | Individual's PINFL, 14 digits; shorter fails "String should have at least 14 characters".                                                                                    | W (c282, c285), D |
| `activityType` | integer | Yes      | `1` individual entrepreneur (YATT), `2` self-employed, `3` income above 100 million (currency and period unstated); above 3 fails "Input should be less than or equal to 3". | W (c282, c284), D |

Success, D; `result.data` depends on the answer:

| `activityType` | `result`                                                                                     | Fixture                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1, negative    | `{"success": false, "reason": "<Uzbek Cyrillic text>", "data": 200}`                         | [negative](../../tests/fixtures/fiscalization/checkActivityType.negative.docs.json)         |
| 2              | `{"success": true, "reason": "Success", "data": null}`                                       | [selfEmployed](../../tests/fixtures/fiscalization/checkActivityType.selfEmployed.docs.json) |
| 3              | `{"success": true, "reason": "Success", "data": {"status": true, "activityNames": ["..."]}}` | [highIncome](../../tests/fixtures/fiscalization/checkActivityType.highIncome.docs.json)     |

`reason` is upstream free text. The examples read as follows (M 2026-11-15): for types 1 and 2,
`success` is the answer, since the negative type-1 example is a "no" from a check that ran; for type
3, `success` says the check ran and `data.status` is the answer. DEV answers `permission_denied` (W
c283, c1304). By inference only: Didox, which may use the same tax-service upstream, returned the
same `{success, reason, data}` object as `error.data` of `400 gateway_not_working` (W c318, c322 are
Didox responses, not activity-type responses).

| Code                 | Description                                                              | Grade                |
| -------------------- | ------------------------------------------------------------------------ | -------------------- |
| `validation_error`   | Missing field, non-integer or out-of-range `activityType`, short `pinfl` | W (c282, c284, c285) |
| `permission_denied`  | Fiscalization is not enabled for the merchant                            | W (c283)             |
| `method_not_allowed` | `GET` instead of `POST`                                                  | W (c281)             |

## Observed behavior

DEV live run 2026-11-12; no numbered capture.

- `GET status/` with an unknown `transactionId` (a random UUID) answered HTTP 400
  `transaction_not_found`, and with an unknown `externalId` HTTP 400 `ofd_check_not_found`; neither
  is the no-receipt `success: false` shape (W c274), which a paid transaction without a receipt
  returns.

## Deviations from vendor docs

- The register response table lists flat names (`receiptUrl`, `terminalId`, `receiptId`,
  `fiscalSign`) while the example nests them under `result.ofd`; the table follows the example.
- The register success example starts with a stray `json` token (en, ru); removed.
- The register introduction speaks only of cash payments, although the page documents card payments
  too. Its example sends both identifiers and both `pinfl` and `tin`, contrary to the item rule; it
  is kept as the field-shape example.
- The register example carries `receiptType`, `advanceContractId` and item-level `voucher` and
  `labels`, which no field table lists; they are omitted here.
- The register table marks `transactionId`, `externalId` and `phoneNumber` optional, with the
  payment-type requirement in their descriptions; shown here as the requirement. Live, only `items`
  is required at validation (W c269, c271).
- The status page shows only a found receipt; without one, `success` is `false`, `isRefund` and
  `receiptUrl` are `null` and the other receipt keys are absent (W c274).
- The set-receipt page states `receiptId` "at least 1"; the validator says "greater than 0" (W
  c280), the same rule.
- Status and refund have no error table; their live codes are W, the rest come from the catalogue.
- The activity-type page's en and ru introduction says it "retrieves fiscal receipt data"; uz and
  the request describe an activity-type check, which this page follows. The sandbox bundle sends it
  as `GET`, which returns `405` (W c281).
