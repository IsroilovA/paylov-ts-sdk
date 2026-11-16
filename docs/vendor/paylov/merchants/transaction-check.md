---
source_url: https://developer.paylov.uz/merchants/transaction-check
---

# Transaction Check

## Request parameters

| Name | Type | Description |
| --- | --- | --- |
| account | dict | A dictionary containing fields that are set for the merchant, e.g., order_id |
| amount | int | Payment amount |
| amount_tiyin | int | Payment amount in cent (tiyin) |
| currency | int | 860 or 840 (UZS or USD) |

## Request Example

```json
{
  "jsonrpc": "2.0",
  "id": 1234567,
  "method": "transaction.check",
  "params": {
    "account": {
      "order_id": 12
    } 
    "amount": 500,
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

- EN and RU request examples omit the comma between the account object and amount, producing invalid JSON. UZ includes the comma. UZ status-code link points to English /merchants/statuses; RU uses /ru/merchants/statuses.
- Example block 1, EN versus UZ (including formatting/comment differences):

```diff
--- EN
+++ UZ
@@ -5,7 +5,7 @@
   "params": {
     "account": {
       "order_id": 12
-    } 
+    },
     "amount": 500,
     "amount_tiyin": 50000,
     "currency": 860
```
- Page link targets by language (including localized navigation within the content): EN: `https://developer.paylov.uz/merchants/statuses`; RU: `https://developer.paylov.uz/ru/merchants/statuses`; UZ: `https://developer.paylov.uz/merchants/statuses`.
