---
source_url: https://developer.paylov.uz/subscribe/ofd/register
---

# Register Fiscal Receipt API

This API sends a transaction to the fiscal system (OFD) to generate a fiscal receipt. It registers a cash payment in the OFD system.

## Endpoints

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/fiscalization/register/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

## Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| transactionId | string | No | Unique identifier for the transaction. **Required if it is a Card payment.** |
| items | array | Yes | List of items to be included in the fiscal receipt. |
| externalId | string | No | Unique identifier for the fiscal receipt. **Required if it is a Cash payment.** |
| phoneNumber | string | No | Client phone number who made the payment. Format: `+998*******`. **Required if it is a Cash payment.** |

## Item Object (inside `items`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| title | string | Yes | Name of the item. |
| price | integer | Yes | Price of the item (before discounts), expressed in tiyn |
| discount | integer | No | Discount applied to the item. Cannot exceed the price. |
| count | integer | Yes | Quantity of the item. Must be at least 1. |
| code | string | Yes | Unique code for the item. |
| vat_percent | integer | Yes | VAT percentage applicable to the item. |
| package_code | string | Yes | Package type code. |
| pinfl | string | No | Individual Taxpayer Number (must be 14 digits if provided). |
| tin | string | No | Taxpayer Identification Number (must be 9 digits if provided). INN |

> 💡 **Note:** `pinfl` or `tin` must be provided, but not both

---

## Request Example

Example Request for Card Payment

```json
{
  "transactionId": "string",
  "externalId": "string",
  "phoneNumber": "string",
  "receiptType": 0,
  "advanceContractId": "string",
  "items": [
    {
      "title": "string",
      "price": 0,
      "discount": 0,
      "voucher": 0,
      "count": 1,
      "code": "string",
      "vat_percent": 0,
      "package_code": "string",
      "labels": [
        "string"
      ],
      "pinfl": "string",
      "tin": "string"
    }
  ]
}
```

## Response format

Success Response

```json
json
{"result": {
  "ofd": {
    "receiptUrl": "https://ofd.example.com/receipt/12345",
    "terminalId": "T123456",
    "receiptId": 987654,
    "fiscalSign": "FS123ABC"
  }
}
}
```

## Response Description

| Field | Type | Description |
| --- | --- | --- |
| receiptUrl | string | URL to the generated fiscal receipt. |
| terminalId | string | Terminal ID used for the transaction. |
| receiptId | integer | Unique ID of the fiscal receipt. |
| fiscalSign | string | Fiscal signature of the receipt. |

## Error responses

| Error Code | Description |
| --- | --- |
| `receipt_not_available_for_operation` | The transaction is not eligible for fiscal receipt generation. |
| `field_required` | Required field missing (e.g., `items`). |
| `ofd_check_already_generated` | The transaction already has a fiscal receipt. |
| `ofd_commitent_or_subcommission_not_active` | A receipt item's commitent (TIN) or sub-commission (PINFL) has no active contract in the OFD catalogue. `data`: `itemIndex`, `tin`, `pinfl`. |
| `invalid_amount` | The total price of items does not match the transaction amount. |
| `ofd_error` | An issue occurred while processing with OFD. |
| `fiscal_receipt_not_generated` | Fiscal receipt was not generated successfully. |

## Notes (extraction)
- The success response contains a literal leading `json` line inside its JSON code block, making the example invalid JSON. The request example supplies both `pinfl` and `tin`, despite the mutually exclusive requirement, and uses nonnumeric placeholders for their digit-constrained values. `receiptType`, `advanceContractId`, `voucher`, and `labels` appear in the example but not in the field tables. The introduction describes cash registration although the page also documents card payments. The spelling `tiyn` is preserved.
- RU calls the item field `титул` in its table; EN and UZ call it `title`, and all request examples use `title`. EN and RU include the invalid literal `json` line in the response; UZ omits it and formats a valid JSON response with the same fields and values. Other fields, required flags, units, codes, URLs, and example values agree.
