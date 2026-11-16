---
source_url: https://developer.paylov.uz/a2c/transaction-status
---

# Check Transaction Status

Returns the status of an A2C transaction by `transactionId`.

### Endpoint

```http
GET {BASE_URL}/merchant/a2c/checkTransaction/{transactionId}/
```

### Headers

```http
Authorization: Bearer <ACCESS_TOKEN>
```

### Path Parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| transactionId | string | Yes | A2C transaction ID returned by `performTransaction` |

### Success Response

```json
{
  "status": "0",
  "statusText": "SUCCESS",
  "amountInTiyin": 2500000
}
```

| Field | Type | Description |
| --- | --- | --- |
| status | string | Transaction status code |
| statusText | string | Human-readable transaction status |
| amountInTiyin | integer | Transfer amount in tiyin |

## Notes (extraction)

- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
