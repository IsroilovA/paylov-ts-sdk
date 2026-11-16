---
source_url: https://developer.paylov.uz/subscribe/cancel-payment
---

# Cancel Payment

API for refunding a payment using a transaction ID

## Cancel Payment API

> 💡 **Note:** Please be careful when using this API

#### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/payment/cancel/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `transactionId` | string | Yes | Unique identifier for the transaction |

**Request example**

```json
{
  "transactionId": "9b3bd7be-9327-4608-b886-4353e49df05f" // example this transactionId
}
```

#### Response

On Success, you'll receive:

```json
{
  "error": null,
  "result": {
    "status": "cancelled", 
    "cancelTime": "2025-12-31 11:24:03", 
    "transactionId": "9b3bd7be-9327-4608-b886-4353e49df05f"
  }
}
```

#### Error Response

```json
{
  "error": {
    "code": "transaction_not_available_for_cancel", 
    "message": "transaction_not_available_for_cancel"
  }, 
  "result": null
}
```

#### Error codes

- `permission_denied`

- `transaction_not_found`

- `transaction_not_available_for_cancel`

## Notes (extraction)
- EN, RU and UZ agree on fields, types, required flags, units, codes, URLs and example values. UZ removes the request example’s `// example this transactionId` comment, making that example valid JSON; EN/RU retain it. Formatting differences appear below.
- Source JSON block is invalid JSON (Expecting ',' delimiter); preserved without correction.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -1,22 +1,22 @@
 Authorization: Bearer <ACCESS_TOKEN>
 
 {
-  "transactionId": "9b3bd7be-9327-4608-b886-4353e49df05f" // example this transactionId
+  "transactionId": "9b3bd7be-9327-4608-b886-4353e49df05f"
 }
 
 {
   "error": null,
   "result": {
-    "status": "cancelled", 
-    "cancelTime": "2025-12-31 11:24:03", 
+    "status": "cancelled",
+    "cancelTime": "2025-12-31 11:24:03",
     "transactionId": "9b3bd7be-9327-4608-b886-4353e49df05f"
   }
 }
 
 {
   "error": {
-    "code": "transaction_not_available_for_cancel", 
+    "code": "transaction_not_available_for_cancel",
     "message": "transaction_not_available_for_cancel"
-  }, 
+  },
   "result": null
 }
```
