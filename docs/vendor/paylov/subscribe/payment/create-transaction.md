---
source_url: https://developer.paylov.uz/subscribe/payment/create-transaction
---

# Create Payment Transaction

### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL`/merchant/receipts/create/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

| Fields | sample_data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| userId | 123 | string | No | userId (ID declared by the merchant) |
| amount | 1000 | int | Yes | Amount in SUM (1000 = 1 Thousand SUM) |
| account |  | dict | Yes | (”account”: {} ) send empty dict if merchant does not have additional data to save |

## Request example

```json
{
  "userId": "string",
  "amount": 1000,
  "account": {
    "additionalProp1": "string",
    "additionalProp2": "string",
    "additionalProp3": "string"
  }
}
```

## Success response example

```json
{
  "transactionId": "string"
}
```

## Error response example

```json
{
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

## Notes (extraction)
- RU account description says to send empty text (“пустой текст”); EN/UZ say empty dict. All versions type account as dict and show an empty object.
