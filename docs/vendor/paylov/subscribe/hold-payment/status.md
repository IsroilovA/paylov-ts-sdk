---
source_url: https://developer.paylov.uz/subscribe/hold-payment/status
---

# Get Hold Status

> **Method:** `GET`<br>**Endpoint:** BASE_URL`/merchant/payment/hold/status/`<br>**queryParams:** `externalId` or `transactionId`

### Example GET request with external id

> **Method:** `GET`<br>**URL:** BASE_URL/`merchant/payment/hold/status/?externalId=123`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

## Response

```json
{
  "result": {
    "transactionId": "d1be13da-4355-4b27-956d-d83b87e013f1",
    "status": "cancelled",
    "cancelTime": "2025-02-03 11:13:42",
    "payedAt": null,
    "amount": 10,
    "serviceId": "d1be13da-4355-4b27-956d-d83b87e013f1"
  }
}
```

## Result statuses

`paid` - success transaction<br>`cancelled` - cancelled transaction<br>`hold` - hold transaction, can be charged if hold time have not been expired<br>`created`

## Error response structure

```json
{
  "error": {
    "code": "hold_not_found",
    "message": "hold_not_found"
  }
}
```

## Error codes

```plaintext
hold_not_found
hold_time_expired
invalid_amount
field_not_valid
gateway_not_working
field_required
transaction_not_found
```

## Notes (extraction)
- EN/RU list created without an explanation; UZ describes it as created. Statuses here are paid/cancelled/hold/created, differing from the payment transaction-status page’s payed/cancel codes.
