---
source_url: https://developer.paylov.uz/a2c/balance
---

# Get Account Balance

Returns the merchant account deposit balance available for A2C transfers.

### Endpoint

```http
GET {BASE_URL}/merchant/a2c/balance/
```

### Headers

```http
Authorization: Bearer <ACCESS_TOKEN>
```

### Success Response

```json
{
  "balance": 50000
}
```

| Field | Type | Description |
| --- | --- | --- |
| balance | integer | Available balance in tiyin |

Balance format

`50000` means `500.00 UZS`.

## Notes (extraction)

- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
