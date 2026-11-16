---
source_url: https://developer.paylov.uz/a2c/deposit-webhook
---

# Deposit Webhook

Webhook sent to the merchant when a deposit is added to the merchant account.

When Paylov adds an A2C, Paynet or Munis deposit to your merchant account, Paylov sends a `merchant.deposit` webhook to your merchant endpoint. The webhook is sent only for incoming deposits.

Remember

Before you can receive webhooks, the webhook URL, `username` and `password` must first be attached to your merchant on the Paylov side. Send these details to Paylov — until they are attached, no webhook is sent.

### Request

```http
POST <WEBHOOK_URL>
```

### Headers

```http
Authorization: Basic base64(username:password)
Content-Type: application/json
```

The request is sent as a JSON-RPC 2.0 notification.

### Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "merchant.deposit",
  "params": {
    "id": "6f1c2b7e-3d4a-5b8c-9e0f-1a2b3c4d5e6f",
    "merchant": "125",
    "type": "a2c",
    "amount_in_tiyin": 10000000,
    "create_time": 1767162243
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| id | string | Unique deposit ID (UUID) |
| merchant | string | Merchant ID |
| type | string | Deposit type: `a2c`, `paynet` or `munis` |
| amount_in_tiyin | integer | Deposit amount in tiyin |
| create_time | integer | Deposit creation time, Unix timestamp in seconds |

Amount format

`10000000` means `100 000.00 UZS`.

### Expected Response

Return any HTTP `2xx` status code. The response body is not checked.

Retries

If your endpoint returns a non-`2xx` status or does not respond (connect timeout 5s, read timeout 30s), the webhook is retried up to 3 times with a 60-second interval. The same webhook may be delivered more than once — use `id` to ignore duplicates.

## Notes (extraction)

- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
