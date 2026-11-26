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
   ([units](README.md#amount-units-by-operation), D, W c1719–c1721, c1740).
2. Paylov creates a sub-transaction per recipient and marks the parent as split (D): the create
   answers at once, `splitPayment/status/` lists the shares `paid` right after, and
   [`getTransactions`](transactions.md) reads the parent `payed` with `is_split: true` (W c1740,
   c1741, c1745). A repeated create answers `split_already_done` (D, W c1743, c1786).
3. The merchant [reads status](#get-split-payment-status) by the parent id. Recipient items are
   registered with the OFD in the background: the receipt appears in the status result seconds later
   (W c1778–c1780), or never when the OFD rejects an item (W c1801, c1802).
4. A [`payment/cancel`](payments.md#cancel-refund-payment) of the parent refunds the split payment:
   every share reads `cancelled`, the parent reads `cancel` with `is_split: true`, and a fiscalized
   split gets its refund receipt seconds later (W c1746–c1749, c1766, c1767, c1810–c1813). `check`
   was never observed; it passes through as an open value (M 2026-11-25).

A captured card hold can be split, per the Paylov team (answer relayed by the maintainer,
2026-11-26); the docs name only a paid transaction (D). No split of a hold was tried on DEV.

On DEV the merchant's own id, the `serviceId` a hold reports ([holds](holds.md#status), W c1714), is
accepted as a recipient; it is the only recipient that succeeded, so no sub-merchant or third-party
recipient was observed (W c1724, c1740). Whether recipient ids are
[sub-merchant ids](sub-merchants.md) is undocumented [OPEN Q108].

Split payments are enabled per merchant: a merchant without them gets `400 permission_denied`
without `data` from both endpoints, also for an unknown transaction or recipient (W c213, c214,
c217, c1451, c1452). Validation runs before that gate (W c212, c215, c220). The DEV merchant was
enabled by 2026-11-25 (W c1708, c1709).

## Create split payment

`POST {BASE_URL}/merchant/splitPayment/`

| Name                       | Type                                           | Required | Description                                                                                                                         | Grade                  |
| -------------------------- | ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `transactionId`            | string (UUID)                                  | Yes      | The paid transaction; "transactionId must be a valid UUID".                                                                         | W (c212, c221)         |
| `recipients`               | array                                          | Yes      | At least 1 item ("List should have at least 1 item after validation, not 0"); a string fails "Input should be a valid list".        | W (c215, c221)         |
| `recipients[].recipientId` | string (UUID)                                  | Yes      | Recipient id issued by Paylov; "recipientId must be a valid UUID", so the docs example is invalid.                                  | W (c220, c1725), D     |
| `recipients[].amount`      | integer                                        | Yes      | Amount in tiyin ([units](README.md#amount-units-by-operation)); recipients must total the transaction amount.                       | W (c220, c1721, c1740) |
| `recipients[].items`       | array of [items](fiscalization.md#item-object) | No       | Fiscal receipt items for this recipient; sending them starts OFD fiscalization.                                                     | W (c220, c1777), D     |
| `resendOFD`                | boolean                                        | No       | Resubmit the items of an existing split to the OFD ([resend](#resend-to-the-ofd)); "maybe" fails "Input should be a valid boolean". | W (c220, c1806), D     |

The item object is the OFD register item: the validator requires the same six fields and leaves
`discount` optional (W c220 versus c270). `tin` appears only in the example; the table lists `pinfl`
alone (D). Unlike [register](fiscalization.md#item-object), the split validator accepts an item
without `tin` and `pinfl`; the create then fails with `ofd_comitent_not_provided` (W c1739). An item
with `tin` `123654987` registered (W c1777, c1780). The create does not compare items with the
share: one item of `price` 50000 for a share of 100000 split successfully, and so did one of `price`
100000 for a share of 50000 (W c1759, c1760, c1956).

The split has one receipt for the whole parent transaction, so registration compares the items of
all recipients with the transaction amount, not with each share. Of a 100000 transaction split into
two shares of 50000, one with items and one without:

- Items totalling 50000 on the share with items failed registration; the next resend's
  `lastOfdError` read
  `failed to validate receipt math: difference 50000 between 50000 and 100000 is larger than 10000`
  (W c1940, c1942, c1958, c1960). The limit of 10000 in the message was not tested.
- Items totalling 100000 on that one share registered within 5 s, the share without items beside it
  (W c1960, c1961).

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

Success (D, W c1740, [fixture](../../tests/fixtures/splits/create.success.wire.json)); the returned
`transactionId` is the parent transaction (W c1740):

```json
{
  "result": {
    "transactionId": "<transaction_id>"
  }
}
```

Checks run in this order: request validation, the transaction (`transaction_not_found`,
`receipt_not_available_for_split`), the amount total, then recipient lookup: an unknown recipient
with a wrong total answers `invalid_amount` (W c1709, c1723, c1729). `recipient_not_found` lists
only the unknown ids (W c1724). One recipient id may appear in several allocations, giving one share
each (W c1764, c1765).

### Resend to the OFD

`resendOFD: true` resubmits the items of an existing split and splits nothing (W c1806, c1823):

- After a split whose registration failed (`package_code` the OFD rejects), a resend with corrected
  items answered success with the parent id, `status` `sent_to_ofd` and `lastOfdError`, the earlier
  OFD response as text; the receipt from the resent items appeared seconds later (W c1800–c1807,
  [fixture](../../tests/fixtures/splits/resendReceipt.success.wire.json)):

  ```json
  {
    "result": {
      "transactionId": "<transaction_id>",
      "status": "sent_to_ofd",
      "lastOfdError": "{'Code': 30, 'Message': 'failed to validate receipt item spic: invalid package code values of items: [0]'}"
    },
    "error": null
  }
  ```

- Once a receipt exists, a resend answers `ofd_check_already_generated` (W c1784, c1809).
- Without a split, also with items, it answers `split_not_found` and creates no split (W c1823,
  c1825).
- Without items on any recipient it answers `field_required` with `data` `{"field": "items"}` (W
  c1744). A recipient without items beside one with items is accepted, as in the create example,
  which carries `resendOFD` (D): such resends answered `sent_to_ofd`, and one whose items totalled
  the transaction registered (W c1942, c1958, c1960, c1961).
- Without `resendOFD`, a create for a split transaction answers `split_already_done`, also after a
  failed registration (W c1805).

A resend while the first registration is still pending was not tried; consumers resend only after
the status result has shown no receipt (M 2026-11-25). A failed registration leaves no trace in the
status result or [fiscalization status](fiscalization.md) (`success: false`); only a resend's
`lastOfdError` reports it (W c1801–c1803, c1806).

| Code                                        | Description                                                                                                                                                                                        | Grade                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `validation_error`                          | Field map; recipient and item errors use index maps such as `{"recipients": {"0": {"items": {"0": {"title": [...]}}}}}` ([fixture](../../tests/fixtures/splits/create.nestedValidation.wire.json)) | W (c212, c215, c216, c220, c221) |
| `permission_denied`                         | Split payments are not enabled for the merchant                                                                                                                                                    | W (c213, c214)                   |
| `transaction_not_found`                     | The transaction does not exist                                                                                                                                                                     | W (c1709), D                     |
| `receipt_not_available_for_split`           | The transaction is not paid; message "Transaction status not paid."                                                                                                                                | W (c1729)                        |
| `split_already_done`                        | The transaction was already split                                                                                                                                                                  | W (c1743, c1786, c1805), D       |
| `invalid_amount`                            | The recipient amounts do not add up to the transaction amount, below or above                                                                                                                      | W (c1719–c1721, c1723), D        |
| `recipient_not_found`                       | A recipient does not exist; `data.notFoundRecipientIds` lists the unknown ones ([fixture](../../tests/fixtures/splits/create.recipientNotFound.wire.json))                                         | W (c1722, c1724), D              |
| `ofd_comitent_not_provided`                 | An item has neither `tin` nor `pinfl`; no `data`                                                                                                                                                   | W (c1739)                        |
| `ofd_commitent_or_subcommission_not_active` | An item's TIN or PINFL has no active OFD contract; `data`: `itemIndex`, `tin`, `pinfl` ([register](fiscalization.md#register-fiscal-receipt))                                                      | D                                |
| `ofd_check_already_generated`               | A resend after the split's receipt was registered                                                                                                                                                  | W (c1784, c1809)                 |
| `split_not_found`                           | A resend for a transaction without a split                                                                                                                                                         | W (c1823, c1825)                 |
| `field_required`                            | A resend without items; `data` `{"field": "items"}`                                                                                                                                                | W (c1744)                        |

## Get split payment status

`GET {BASE_URL}/merchant/splitPayment/status/?transactionId=<transactionId>`

`transactionId` (string, required, W c218) is the parent transaction id (D).

The documented success (D) is an array with one entry per recipient:

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

DEV appends one more entry, `{"ofd": {...}}`, after the recipient entries (W c1741, c1765, c1780,
[fixtures](../../tests/fixtures/splits/get.saleReceipt.wire.json),
[two shares](../../tests/fixtures/splits/get.twoShares.wire.json)):

```json
{
  "result": [
    {
      "recipientId": "<recipient_id>",
      "amount": 100000,
      "status": "paid",
      "createdAt": "2026-11-25 11:56:42"
    },
    {
      "ofd": {
        "isRefund": false,
        "receiptUrl": "https://ofd.soliq.uz/epi?t=<terminal_id>&r=4178&c=20261125115642&s=<fiscal_sign>",
        "terminalId": "<terminal_id>",
        "receiptId": 4178,
        "fiscalSign": "<fiscal_sign>"
      }
    }
  ],
  "error": null
}
```

| Field         | Type    | Description                                                                                                                  | Grade                   |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `recipientId` | string  | Recipient id.                                                                                                                | W (c1741), D            |
| `amount`      | integer | Recipient amount in tiyin ([units](README.md#amount-units-by-operation)).                                                    | W (c1741), D            |
| `status`      | string  | `paid` after the split, `cancelled` after the parent is refunded; `check` is listed without a meaning and was not observed.  | W (c1741, c1747), D     |
| `createdAt`   | string  | `YYYY-MM-DD HH:MM:SS` in Tashkent time, UTC+05:00: a split sent at 06:55:41.975 UTC reads `11:55:42`; unchanged by a refund. | W (c1740, c1741, c1789) |
| `ofd`         | object  | `{}` without a receipt; otherwise the [receipt status](fiscalization.md#get-fiscal-receipt-status) fields without `success`. | W (c1741, c1780, c1813) |

`ofd` holds the split's current receipt, the one [fiscalization status](fiscalization.md) without
`refunded` returns (W c1780, c1782). It reads `{}` for a split without items (W c1741), for 2 s
after a split with items and with the sale receipt 7 s after it (W c1778–c1780), and `{}` throughout
after a failed registration (W c1801, c1802). Right after a refund it reads `{}`; 5 s later it holds
the refund receipt with `isRefund: true` (W c1811, c1813).

| Code                    | Description                                                                                                                                             | Grade                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `validation_error`      | `transactionId` missing                                                                                                                                 | W (c218)                |
| `permission_denied`     | Split payments are not enabled; answered also for a paid transaction that was never split and for an unknown transaction                                | W (c217, c1451)         |
| `method_not_allowed`    | `POST` instead of `GET`                                                                                                                                 | W (c219)                |
| `transaction_not_found` | The transaction does not exist ([fixture](../../tests/fixtures/splits/get.transactionNotFound.wire.json)); another merchant's transaction was not tried | W (c1708), D            |
| `split_not_found`       | The transaction exists but has no split: paid, unpaid, or after failed creates ([fixture](../../tests/fixtures/splits/get.splitNotFound.wire.json))     | W (c1717, c1726, c1728) |

## Deviations from vendor docs

- The create and status examples carry `#in tiyn` and `# tin or pinfl` comments, making them invalid
  JSON (en, ru; uz drops them along with the unit hint); removed, with the unit kept in the
  [units table](README.md#amount-units-by-operation) (D).
- The create table marks item `discount` required; the validator does not require it (W c220). The
  shared [item rules](fiscalization.md#item-object) apply.
- The status example's second `recipientId` (`...26dv9fefb111`) is not a valid UUID; recipient ids
  have no documented UUID requirement (D).
- The status `result` carries an extra `{"ofd": {...}}` entry after the recipient entries, and the
  recipient ids must be UUIDs (W c1725, c1741).
- `resendOFD` is not a create option: with it the call splits nothing and answers a different
  success shape (W c1806, c1823).
- The sandbox bundle's create shape and its `POST` status with `splitId` are wrong: they return
  `validation_error` and `405` (W c216, c219).
