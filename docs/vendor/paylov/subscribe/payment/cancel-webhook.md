---
source_url: https://developer.paylov.uz/subscribe/payment/cancel-webhook
---

# Cancel Webhook

Webhook sent to the merchant when a transaction is cancelled

## Overview

A transaction can be cancelled in two ways:

- by you (the client) from the Paylov business panel

- by Paylov processing staff

In both cases Paylov sends a `transaction.cancel` webhook to your merchant endpoint.

Remember

Before you can receive webhooks, the webhook URL, `username` and `password` must first be attached to your merchant on the Paylov side. Send these details to Paylov — until they are attached, no webhook is sent.

#### Request details

> **Method:** `POST`<br>**URL:** your webhook URL<br>**Header:**

```http
Authorization: Basic base64(username:password)
Content-Type: application/json
```

The request is sent as a JSON-RPC 2.0 notification.

**Request example**

```json
{
  "jsonrpc": "2.0",
  "method": "transaction.cancel",
  "params": {
    "transaction_id": "9b3bd7be-9327-4608-b886-4353e49df05f",
    "status": "cancelled",
    "account": {
      "order_id": "12345"
    },
    "amount": 1500,
    "amount_in_tiyin": 150000,
    "cancel_time": 1767162243
  }
}
```

**Params**

| Field | Type | Description |
| --- | --- | --- |
| `transaction_id` | string | Paylov transaction ID |
| `status` | string | Always `cancelled` |
| `account` | object | Account fields sent when the transaction was created |
| `amount` | integer | Amount in UZS (whole part only) |
| `amount_in_tiyin` | integer | Amount in tiyin. Use this field for exact amounts |
| `cancel_time` | integer | Cancellation time, Unix timestamp in seconds |

#### Expected response

Return any HTTP `2xx` status code. The response body is not checked.

Retries

If your endpoint returns a non-`2xx` status or does not respond (connect timeout 5s, read timeout 30s), the webhook is retried up to 3 times with a 60-second interval. The same webhook may be delivered more than once — use `transaction_id` to ignore duplicates.

## Notes (extraction)
- EN, RU and UZ agree on fields, types, required flags, units, codes, URLs and examples; prose and labels are translated.
