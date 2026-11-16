---
source_url: https://developer.paylov.uz/subscribe/ofd/refund-receipt
---

# Refund Fiscal Receipt API

This API sends a transaction to the fiscal system (OFD) to generate a **refund** fiscal receipt.

### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/fiscalization/refund/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

## Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| receiptId | integer | Yes | Unique identifier of a fiscal receipt. This value is returned when registering a fiscal receipt or can be retrieved from the `/fiscalization/status/` API. |

## Request example

```json
{
  "receiptId": 184595
}
```

## Response example

```json
{
  "result": {
    "ofd": {
      "refund": {
        "receiptUrl": "https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001",
        "terminalId": "EP000000000378",
        "receiptId": 184636,
        "fiscalSign": "583109124612"
      }
    },
    "sale": {
      "receiptUrl": "https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001",
      "terminalId": "EP000000000378",
      "receiptId": 184595,
      "fiscalSign": "290464420473"
    }
  }
}
```

**Notes**

- Card Payment Fiscalization: If fiscalization has been performed for a card payment, you must cancel the transaction using the `/payment/cancel/` method. When the transaction is canceled, the fiscalization will also be canceled.

- Status Check: Retrieve the status of the fiscalization using the `/fiscalization/status/` method.

- Refund Processing: If fiscalization for a refund is not available via the `/fiscalization/status/` API, send a request to this `/fiscalization/refund/` endpoint to process the refund fiscalization.

## Notes (extraction)
- EN, RU and UZ agree.
