---
source_url: https://developer.paylov.uz/merchants/statuses
---

# Statuses

`0` – Success<br>`3` – Maintenance is in process<br>`5` – Invalid amount<br>`303` – Order not found

`+1` – Custom error message from merchant service provider if status is +1, Merchants can send their custom message like `{"statusText": "monthly_limit_exceeded"}`

```json

{
   "jsonrpc": "2.0",
   "id": 1234567,
   "result": {
      "status": "+1",
      "statusText": "monthly_limit_exceeded"
   }
}
```

## Notes (extraction)

- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
- Example block 1, EN versus UZ (including formatting/comment differences):

```diff
--- EN
+++ UZ
@@ -1,9 +1,8 @@
-
 {
-   "jsonrpc": "2.0",
-   "id": 1234567,
-   "result": {
-      "status": "+1",
-      "statusText": "monthly_limit_exceeded"
-   }
+  "jsonrpc": "2.0",
+  "id": 1234567,
+  "result": {
+    "status": "+1",
+    "statusText": "monthly_limit_exceeded"
+  }
 }
```
