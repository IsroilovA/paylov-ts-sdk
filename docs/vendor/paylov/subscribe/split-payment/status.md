---
source_url: https://developer.paylov.uz/subscribe/split-payment/status
---

# Get Split Payment Status

#### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL/`merchant/splitPayment/status/?transactionId=your_transaction_id`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Description:** Retrieves the status of all sub-transactions for a split transaction.

| Parameter | Type | Description | Required |
| --- | --- | --- | --- |
| `transactionId` | string | The ID of the parent transaction. | Yes |

**Response example**<br> On Success,

```json
{
  "result": [
    {
      "recipientId": "ccda5111-66a0-4896-90a2-b095ff558129",
      "amount": 100,  #in tiyn
      "status": "paid",
      "createdAt": "2025-01-06 17:17:17"
    },
    {
      "recipientId": "ffddb832-4bd2-410c-a1d9-26dv9fefb111",
      "amount": 100,
      "status": "paid",
      "createdAt": "2025-01-06 17:17:17"
    }
  ]
}
```

#### Error codes

- `permission_denied`

- `transaction_not_found`

- `split_not_found`

#### Implementation notes

- **Permission check:** Verify that the merchant has split payment permissions.

- **Transaction validation:** Ensure the parent transaction exists and belongs to the merchant.

- **Status mapping:**

  - `paid`

  - `cancelled`

- `check`

## Notes (extraction)
- EN and RU response JSON includes `#in tiyn`, making it invalid JSON. UZ removes that comment, omitting the explicit unit hint. Fields, values, statuses, flags, URLs, and error codes otherwise agree.
