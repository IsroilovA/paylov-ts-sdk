---
source_url: https://developer.paylov.uz/subscribe/service-payment/transaction-status
---

# Get Transaction Status

Returns transaction status

#### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL/`servicePayment/transaction/status/?transactionId=b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

| Query param | Type | Description |
| --- | --- | --- |
| transactionId | string | transaction id |

**Response example**

```json
{
  "result": {
    "transactionId": "b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26",
    "status": "paid",
    "payedAt": "2024-10-14 15:07:23",
    "serviceId": "9f877739-bc25-4f0f-a13f-ec485fd04250",
    "cancelTime": null,
    "amount": 500
  }
}
```

#### Status Codes

- `paid`: successfully completed transaction

- `cancelled`: cancelled transaction

- `created`: created

## Notes (extraction)
- EN, RU and UZ agree.
