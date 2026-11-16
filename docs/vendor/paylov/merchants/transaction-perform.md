---
source_url: https://developer.paylov.uz/merchants/transaction-perform
---

# Transaction Perform

## Request parameters

| Name | Type | Description |
| --- | --- | --- |
| transaction_id | UUID4 | Transaction ID |
| account | dict | A dictionary containing fields that are set for the merchant, e.g., order_id |
| amount | int | Payment amount |
| amount_tiyin | int | Payment amount in cent (tiyin) |
| currency | int | 860 or 840 (UZS or USD) |

## Request Example

```json
{
  "jsonrpc": "2.0",
  "id": 1234567,
  "method": "transaction.perform",
  "params": {
    "transaction_id": "9bd1a92b-5cce-47c8-a2df-99a20836ab9e",
    "account": {
      "order_id": 12
    }, 
    "amount":500,
    "amount_tiyin": 50000,
    "currency": 860
  }
}
```

## Response example

```json
{
  "jsonrpc": "2.0",
  "id": 1234567,
  "result": {
    "status": "0",
    "statusText": "OK"
  }
}
```

For more status codes see [Status codes](https://developer.paylov.uz/merchants/statuses)

## Notes (extraction)

- UZ status-code link points to English /merchants/statuses; RU uses /ru/merchants/statuses.
- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
- Example block 1, EN versus UZ (including formatting/comment differences):

```diff
--- EN
+++ UZ
@@ -6,8 +6,8 @@
     "transaction_id": "9bd1a92b-5cce-47c8-a2df-99a20836ab9e",
     "account": {
       "order_id": 12
-    }, 
-    "amount":500,
+    },
+    "amount": 500,
     "amount_tiyin": 50000,
     "currency": 860
   }
```
- Page link targets by language (including localized navigation within the content): EN: `https://developer.paylov.uz/merchants/statuses`; RU: `https://developer.paylov.uz/ru/merchants/statuses`; UZ: `https://developer.paylov.uz/merchants/statuses`.
