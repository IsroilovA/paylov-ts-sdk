---
source_url: https://developer.paylov.uz/subscribe/hold-payment/dismiss
---

# Dismiss Hold

> This API is useful when the reserved funds should be made available to the user again. Held Money will be available user bank card.

> **Method:** `POST`<br>**URL** `/merchant/payment/hold/dismiss/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

## Request Body

```json

{
  "transactionId": "string"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| transactionId | string | Yes | The unique identifier for the hold transaction you wish to cancel. |

## Success response

```json

{
  "result": {
    "transactionId": "uuid",
    "status": "cancelled"
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| transactionId | string (UUID) | The unique ID of the dismissed hold transaction. |
| status | string | The status of the transaction. |

## Notes (extraction)
- EN/RU endpoint label is “URL” without colon; UZ uses “URL:”. Endpoint omits BASE_URL in all versions.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -1,10 +1,8 @@
 Authorization: Bearer <ACCESS_TOKEN>
-
 
 {
   "transactionId": "string"
 }
-
 
 {
   "result": {
```
