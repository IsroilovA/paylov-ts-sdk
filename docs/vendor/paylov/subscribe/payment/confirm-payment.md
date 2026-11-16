---
source_url: https://developer.paylov.uz/subscribe/payment/confirm-payment
---

# Confirm Payment

### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL`/merchant/receipts/pay/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

| Fields | sample_data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| transactionId | 9f877739-bc25-4f0f-a13f-ec485fd04250 | string | Yes | transactionId that is returned by the /receipts/create/ method |
| cardId | 9f877739-bc25-4f0f-a13f-ec485fd04250 | string | Yes | cardId that is created in Paylov system |
| userId | 123 | string | Yes | userId (ID declared by the merchant) |

## Request body

```json
{
  "transactionId": "string",
  "cardId": "string",
  "userId": "string"
}
```

## Successful response

```json
{
  "result": {
    "transactionId": "9b370dde-dfe1-4365-be8a-d3581c9479ba"
  }
}
```

## Error response

```json
{
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

## Notes (extraction)
- EN, RU and UZ agree on fields, types, required flags, units, codes, URLs and examples; prose and labels are translated.
