---
source_url: https://developer.paylov.uz/subscribe/payment/transaction-status
---

# Get Transaction Status

### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL`/merchant/getTransactions/?id=your_transaction_id`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Query params**

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string (UUID) | Yes | Transaction ID |

### Successful response

```json
{
  "result": {
    "totalTransaction": 1,
    "transactions": [
      {
        "id": "3667c3fb-68a5-4d1c-bd86-99df49c895d9",
        "external_id": "order-12345",
        "userId": null,
        "card_id": "9a192005-f61c-4874-51a3-f3bf154d6feb",
        "cardNumber": "986030******9999",
        "owner": "Levi A.",
        "amount": 1000.0,
        "amount_in_tiyin": 100000,
        "status": "payed",
        "account": {
          "order_id": "12345"
        },
        "cancel_time": null,
        "error_message": null,
        "date": "2026-04-01 06:38:38",
        "is_split": false,
        "is_hold": false,
        "is_a2c": false,
        "transaction_type": "To'lov",
        "via_link": true,
        "ofd": [
          {
            "receipt_id": 123456,
            "qr_code_url": "https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001",
            "date_time": "2026-04-01 06:38:38",
            "is_refund": false
          }
        ]
      }
    ]
  },
  "error": null
}
```

**Statuses**

| Status | Description |
| --- | --- |
| `created` | Transaction created |
| `transfer` | Transfer in progress |
| `pending` | Pending |
| `waiting` | Waiting |
| `payed` | Paid successfully |
| `failed` | Failed |
| `cancel` | Cancelled |
| `refunded` | Refunded |

If no transaction is found, an empty list is returned:

```json
{
  "result": {
    "totalTransaction": 0,
    "transactions": []
  },
  "error": null
}
```

### Error response

`400 Bad Request` — `id` is not sent:

```json
{
  "result": null,
  "error": {
    "code": "field_required",
    "message": "A required field is missing.",
    "data": {
      "field": "query"
    }
  }
}
```

`400 Bad Request` — `id` is not a valid UUID:

```json
{
  "result": null,
  "error": {
    "code": "validation_error",
    "message": "The request contains invalid data.",
    "data": {
      "transactionId": ["Must be a valid UUID."]
    }
  }
}
```

`400 Bad Request` — unknown query param is sent:

```json
{
  "result": null,
  "error": {
    "code": "field_not_valid",
    "message": "The field is not valid.",
    "data": {
      "field": "transaction"
    }
  }
}
```

## Notes (extraction)
- EN, RU and UZ agree on fields, types, required flags, units, codes, URLs and examples; prose and labels are translated.
