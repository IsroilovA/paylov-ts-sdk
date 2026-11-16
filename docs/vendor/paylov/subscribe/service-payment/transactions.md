---
source_url: https://developer.paylov.uz/subscribe/service-payment/transactions
---

# Get All Transactions

Returns all “paid” service Payment Transactions of a merchant.<br> Can be filtered by serviceId, userId, beginDate, endDate

#### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL/`servicePayment/transaction/all`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Response example**

```json
{
  "result": {
    "totalTransaction": 2,
    "transactions": [
      {
        "id": "2e701897-b04b-4fb0-99c5-520d78d557db",
        "userId": "646",
        "cardNumber": "986034******8885",
        "owner": "BOTIROV TEMURBEK",
        "amount": 500,
        "date": "2024-11-21 11:48:47",
        "serviceId": "3b03419c-2850-401f-b418-75d4c9b71b66"
      },
      {
        "id": "6aa8b698-cd79-4187-a822-21ac3f421839",
        "userId": "646",
        "cardNumber": "986034******8885",
        "owner": "BOTIROV TEMURBEK",
        "amount": 500,
        "date": "2024-09-30 11:26:32",
        "serviceId": "3b03419c-2850-401f-b418-75d4c9b71b66"
      }
    ],
    "error": null
  }
}
```

## Notes (extraction)
- EN, RU and UZ agree.
