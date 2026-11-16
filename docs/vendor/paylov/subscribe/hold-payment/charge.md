---
source_url: https://developer.paylov.uz/subscribe/hold-payment/charge
---

# Charge Hold

> **Method:** `POST`<br>**URL:** `/merchant/payment/hold/charge/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

## Request body

```json

{
  "transactionId": "string",
  "amount": 10
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| transactionId | string | Yes | The unique identifier for the user. |
| amount | integer | Yes | The amount to charge from the hold. |

## Success Response

```json

{
  "result": {
    "transactionId": "string",
    "cardId": "string",
    "payedAt": "YYYY-MM-DD HH:mm:ss"
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| transactionId | string | The unique identifier for the user. |
| cardId | string | The card used for the charge. |
| payedAt | string | The timestamp when the payment was processed, formatted as `YYYY-MM-DD HH:mm:ss.` |

## Notes (extraction)
- EN/RU describe transactionId as a user identifier in both tables; UZ describes the hold transaction identifier in the request and transaction identifier in the response. Endpoint text omits BASE_URL in all versions.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -1,11 +1,9 @@
 Authorization: Bearer <ACCESS_TOKEN>
-
 
 {
   "transactionId": "string",
   "amount": 10
 }
-
 
 {
   "result": {
```
