---
source_url: https://developer.paylov.uz/subscribe/split-payment/create
---

# Create Split Payment

#### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/splitPayment/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Description:**<br> Splits a transaction amount among multiple recipients. Each recipient receives a sub-transaction with the specified amount. The transaction is marked as split upon successful completion.

> 💡 **Note:** Get the recipientId from (Paylov) the service provider

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `transactionId` | string | Yes | Unique identifier for the transaction. |
| `recipients` | array | Yes | List of recipients receiving the transaction. |
| `recipients[].recipientId` | string | Yes | Unique identifier for the recipient. |
| `recipients[].amount` | number | Yes | Amount allocated to the recipient. |
| `recipients[].items` | array | No | List of items associated with the recipient. |
| `recipients[].items[].title` | string | Yes | Name or title of the item. |
| `recipients[].items[].price` | number | Yes | Price of the item before discounts. |
| `recipients[].items[].discount` | number | Yes | Discount applied to the item. |
| `recipients[].items[].count` | number | Yes | Quantity of the item. |
| `recipients[].items[].code` | string | Yes | Unique code identifying the item. |
| `recipients[].items[].vat_percent` | number | Yes | VAT percentage applicable to the item. |
| `recipients[].items[].package_code` | string | Yes | Code representing the package type. |
| `recipients[].items[].pinfl` | string | No | Taxpayer identification number (PINFL). |
| `resendOFD` | boolean | No | Flag indicating whether to resend data to the fiscal system. |

**Request example**

```json
{
  "transactionId": "9b3bd7be-9327-4608-b886-4353e49df05f",
  "recipients": [
    {
      "recipientId": "string",
      "amount": 100,  #in tiyn
      "items": [
        {
          "title": "string",
          "price": 0,
          "discount": 0,
          "count": 0,
          "code": "string",
          "vat_percent": 0,
          "package_code": "string",
          "tin": "string", # tin or pinfl
          "pinfl": "string"
        }
      ]
    },
    {
      "recipientId": "abda5234-16aq-4896-90a2-b095ff557654",
      "amount": 100
    }

  ],
 "resendOFD": false
}
```

#### Response

On Success, you'll receive:

```json
{
  "result": {
    "transactionId": "<transaction_id>"
  }
}
```

> 💡 **Note:** If items included in the request body, transaction will be send to OFD to generate fiscal data. The transaction is sent to OFD asynchronously, so it won’t wait for a response. OFD might be delayed due to high traffic. After the payment is split, you can check the status using a dedicated method. If the response does not include OFD data, you need to resend the split payment request with `resendOFD: true`

### Error codes

- `permission_denied`

- `transaction_not_found`

- `split_already_done`

- `invalid_amount`

- `recipient_not_found`

- `ofd_commitent_or_subcommission_not_active` — a receipt item's commitent (TIN) or sub-commission (PINFL) has no active OFD contract. `data`: `itemIndex`, `tin`, `pinfl`. See [Error Codes](https://developer.paylov.uz/error-codes).

**Example for `recipient_not_found`:**

```json
{
  "error": {
    "code": "recipient_not_found",
    "message": "One or more recipients not found.",
    "data": {
      "notFoundRecipientIds": [
        "<recipient_id>"
      ]
    }
  }
}
```

**Implementation Notes**

- **Permission Check:** Ensures the merchant has split payment permissions.

- **Validation:**

  - Verifies the transaction exists, is not already split.

  - Ensures the sum of recipients’ amounts matches the transaction amount.

- Checks for the existence of recipient merchants.

## Notes (extraction)
- The request JSON includes `#in tiyn` and `# tin or pinfl` comments, making it invalid JSON. `tin` appears in the example but has no field-table row. Both `tin` and `pinfl` are supplied in the example. The second recipient identifier contains `q` and is not a valid UUID. The spelling `tiyn` is preserved.
- EN and RU include the comments specifying tiyin and `tin or pinfl`; UZ removes both comments, omitting those explicit unit and alternative-field hints from its example. UZ also adjusts whitespace. Fields, types, required flags, error codes, URLs, and example values otherwise agree.
