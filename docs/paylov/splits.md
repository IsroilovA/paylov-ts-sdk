---
sources:
  - https://developer.paylov.uz/subscribe/split-payment/create
  - https://developer.paylov.uz/subscribe/split-payment/status
---

# Split payments

Allocates a paid transaction among Paylov recipients (D). Vendor contracts:
[create](../vendor/paylov/subscribe/split-payment/create.md),
[status](../vendor/paylov/subscribe/split-payment/status.md). Grades:
[evidence](README.md#evidence).

## Flow

1. Paylov supplies recipient ids. The merchant submits the paid parent transaction and one
   allocation per recipient; allocations must total the transaction amount
   ([units](README.md#amount-units-by-operation), D).
2. Paylov creates a sub-transaction per recipient and marks the parent as split (D). A repeated
   create answers `split_already_done` (D).
3. The merchant [reads status](#get-split-payment-status) by the parent id. Each recipient reads
   `paid`, `cancelled` or `check`; transitions and recovery are undocumented (D).

Optional [items](fiscalization.md#item-object) per recipient start an asynchronous OFD submission;
where its result appears and when `resendOFD: true` is safe is [OPEN Q59]. Whether recipient ids are
[sub-merchant ids](sub-merchants.md) is undocumented.

Validation runs before the split-permission gate. On DEV both endpoints answer
`400 permission_denied` without `data`, also for a paid transaction or an unknown recipient, so no
successful allocation or recipient lookup was observed (W c213, c214, c217, c1451, c1452).

## Create split payment

`POST {BASE_URL}/merchant/splitPayment/`

| Name                       | Type                                           | Required | Description                                                                                                                  | Grade                     |
| -------------------------- | ---------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `transactionId`            | string (UUID)                                  | Yes      | The paid transaction; "transactionId must be a valid UUID".                                                                  | W (c212, c221)            |
| `recipients`               | array                                          | Yes      | At least 1 item ("List should have at least 1 item after validation, not 0"); a string fails "Input should be a valid list". | W (c215, c221)            |
| `recipients[].recipientId` | string                                         | Yes      | Recipient id issued by Paylov; the docs example is not a valid UUID.                                                         | W (c220), D               |
| `recipients[].amount`      | integer                                        | Yes      | Amount in tiyin ([units](README.md#amount-units-by-operation)); recipients must total the transaction amount.                | W (c220) required; D unit |
| `recipients[].items`       | array of [items](fiscalization.md#item-object) | No       | Fiscal receipt items for this recipient; sending them starts OFD fiscalization.                                              | W (c220), D               |
| `resendOFD`                | boolean                                        | No       | Resend the split to the OFD; "maybe" fails "Input should be a valid boolean".                                                | W (c220), D               |

The item object is the OFD register item: the validator requires the same six fields and leaves
`discount` optional (W c220 versus c270). `tin` appears only in the example; the table lists `pinfl`
alone (D).

```json
{
  "transactionId": "9b3bd7be-9327-4608-b886-4353e49df05f",
  "recipients": [
    {
      "recipientId": "string",
      "amount": 100,
      "items": [
        {
          "title": "string",
          "price": 0,
          "count": 1,
          "code": "string",
          "vat_percent": 0,
          "package_code": "string",
          "pinfl": "string"
        }
      ]
    },
    { "recipientId": "abda5234-16aq-4896-90a2-b095ff557654", "amount": 100 }
  ],
  "resendOFD": false
}
```

Success, D ([fixture](../../tests/fixtures/splits/create.success.docs.json)):

```json
{
  "result": {
    "transactionId": "<transaction_id>"
  }
}
```

The docs do not say whether the returned `transactionId` equals the parent transaction (D). The OFD
submission is asynchronous and may be delayed; the page says to resend with `resendOFD: true` when
"the response does not include OFD data", yet the documented success carries none ([OPEN Q59]).

| Code                                        | Description                                                                                                                                                                                        | Grade                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `validation_error`                          | Field map; recipient and item errors use index maps such as `{"recipients": {"0": {"items": {"0": {"title": [...]}}}}}` ([fixture](../../tests/fixtures/splits/create.nestedValidation.wire.json)) | W (c212, c215, c216, c220, c221) |
| `permission_denied`                         | Split payments are not enabled for the merchant                                                                                                                                                    | W (c213, c214)                   |
| `transaction_not_found`                     | The transaction does not exist                                                                                                                                                                     | D                                |
| `split_already_done`                        | The transaction was already split                                                                                                                                                                  | D                                |
| `invalid_amount`                            | The recipient amounts do not add up to the transaction amount                                                                                                                                      | D                                |
| `recipient_not_found`                       | A recipient does not exist; `data.notFoundRecipientIds` lists them ([fixture](../../tests/fixtures/splits/create.recipientNotFound.docs.json))                                                     | D                                |
| `ofd_commitent_or_subcommission_not_active` | An item's TIN or PINFL has no active OFD contract; `data`: `itemIndex`, `tin`, `pinfl` ([register](fiscalization.md#register-fiscal-receipt))                                                      | D                                |

## Get split payment status

`GET {BASE_URL}/merchant/splitPayment/status/?transactionId=<transactionId>`

`transactionId` (string, required, W c218) is the parent transaction id (D).

Success, D ([fixture](../../tests/fixtures/splits/get.success.docs.json)); `result` is an array with
one entry per recipient:

```json
{
  "result": [
    {
      "recipientId": "ccda5111-66a0-4896-90a2-b095ff558129",
      "amount": 100,
      "status": "paid",
      "createdAt": "2025-01-06 17:17:17"
    }
  ]
}
```

| Field         | Type    | Description                                                               |
| ------------- | ------- | ------------------------------------------------------------------------- |
| `recipientId` | string  | Recipient id.                                                             |
| `amount`      | integer | Recipient amount in tiyin ([units](README.md#amount-units-by-operation)). |
| `status`      | string  | `paid`, `cancelled` or `check`; the page does not explain them.           |
| `createdAt`   | string  | `YYYY-MM-DD HH:MM:SS`; time zone unstated.                                |

| Code                    | Description                                                                                                                                                                       | Grade           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `validation_error`      | `transactionId` missing                                                                                                                                                           | W (c218)        |
| `permission_denied`     | Split payments are not enabled; answered also for a paid transaction that was never split and for an unknown transaction                                                          | W (c217, c1451) |
| `method_not_allowed`    | `POST` instead of `GET`                                                                                                                                                           | W (c219)        |
| `transaction_not_found` | The transaction does not exist or belongs to another merchant                                                                                                                     | D               |
| `split_not_found`       | Listed without a trigger; uz glosses it "split information not found". Read as a transaction that exists but was never split, since `transaction_not_found` covers an unknown one | D; M 2026-11-15 |

## Deviations from vendor docs

- The create and status examples carry `#in tiyn` and `# tin or pinfl` comments, making them invalid
  JSON (en, ru; uz drops them along with the unit hint); removed, with the unit kept in the
  [units table](README.md#amount-units-by-operation) (D).
- The create table marks item `discount` required; the validator does not require it (W c220). The
  shared [item rules](fiscalization.md#item-object) apply.
- The status example's second `recipientId` (`...26dv9fefb111`) is not a valid UUID; recipient ids
  have no documented UUID requirement (D).
- The sandbox bundle's create shape and its `POST` status with `splitId` are wrong: they return
  `validation_error` and `405` (W c216, c219).
