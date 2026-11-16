---
source_url: https://developer.paylov.uz/subscribe/ofd/get-receipt
---

# Get Fiscal Receipt API

Retrieves fiscal receipt data from the fiscal system.<br>**Endpoint**

> **Method:** `GET`<br>**URL:** BASE_URL/`merchant/fiscalization/status/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

## Request Parameters

| Parameter | Type | Required | Location | Description |
| --- | --- | --- | --- | --- |
| `Authorization` | `Bearer <ACCESS_TOKEN>` | Yes | Header | Access token for API authentication. |
| `transactionId` | `string` (UUID) | No | Query | Unique identifier for the transaction. |
| `externalId` | `string` | No | Query | Unique identifier for the fiscal receipt used in Cash Payment registration. |
| `refunded` | `boolean` | No | Query | Filter fiscal receipts based on refund status. |

> 💡 **Note:** Either `transactionId` or `externalId` must be provided.

---

### Example Request

```plaintext
GET {BASE_URL}/merchant/fiscalization/status/?refunded=false&transactionId=e2da46c6-8c89-400e-8bd9-037297b2e8b1
```

## Response example

```json
{
  "result": {
    "success": true,
    "isRefund": false,
    "receiptUrl": "https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001",
    "terminalId": "EP000000000378",
    "receiptId": 173723,
    "fiscalSign": "947030008479"
  }
}
```

## Notes (extraction)
- EN, RU and UZ agree.
