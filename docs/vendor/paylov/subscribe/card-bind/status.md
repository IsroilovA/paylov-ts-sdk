---
source_url: https://developer.paylov.uz/subscribe/card-bind/status
---

# Bind Status

Optional. If the webhook did not arrive for some reason, the partner backend can check the result with this request.

### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL`/merchant/userCard/bindSession/{token}/status/`<br>**Header:**

```http
Authorization: Bearer < ACCESS_TOKEN >
```

| Path | Type | Required | Description |
| --- | --- | --- | --- |
| token | string | Yes | `token` received when [creating the link](https://developer.paylov.uz/subscribe/card-bind/create-link) |

## Success response

```json
{
  "result": {
    "state": "confirmed",
    "card": {
      "cardId": "b1e2f3a4-...-uuid",
      "userId": "partner-user-10234",
      "owner": "TEST USER",
      "cardName": null,
      "number": "860012******9012",
      "balance": 1500000,
      "expireDate": "2612",
      "bankId": "7",
      "bankName": "Ipoteka Bank",
      "vendor": "uzcard",
      "processing": "Uzcard",
      "status": {
        "is_active": true,
        "status_message": "active",
        "sms_info": true
      }
    }
  },
  "error": null
}
```

**`state` values**

| State | Description |
| --- | --- |
| `created` | Not bound yet |
| `card_pending` | Card entered, waiting for SMS |
| `confirmed` | Bound |

The `card` field is filled only in the `confirmed` state. Its structure is the same as `card` in the [webhook](https://developer.paylov.uz/subscribe/card-bind/webhook).

## Fail response

```json
{
  "result": null,
  "error": {
    "code": "link_expired",
    "message": "This link has expired. Please request a new one."
  }
}
```

## Notes (extraction)
- Example owner is TEST USER in EN, ТЕСТОВЫЙ ПОЛЬЗОВАТЕЛЬ in RU, and TEST FOYDALANUVCHI in UZ.
- Complete literal code/example differences for RU (including whitespace and translated comments):

```diff
--- EN code blocks
+++ RU code blocks
@@ -6,7 +6,7 @@
     "card": {
       "cardId": "b1e2f3a4-...-uuid",
       "userId": "partner-user-10234",
-      "owner": "TEST USER",
+      "owner": "ТЕСТОВЫЙ ПОЛЬЗОВАТЕЛЬ",
       "cardName": null,
       "number": "860012******9012",
       "balance": 1500000,
```
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -6,7 +6,7 @@
     "card": {
       "cardId": "b1e2f3a4-...-uuid",
       "userId": "partner-user-10234",
-      "owner": "TEST USER",
+      "owner": "TEST FOYDALANUVCHI",
       "cardName": null,
       "number": "860012******9012",
       "balance": 1500000,
```
