---
source_url: https://developer.paylov.uz/subscribe/card-bind/webhook
---

# Card Bind Webhook

Webhook Paylov sends to the partner system after a card is bound successfully.

Setup required

The webhook URL (endpoint) and its Basic Auth login/password are configured in advance together with Paylov (stored in the merchant profile). If this is not configured yet, tell the Paylov technical team which URL and login/password to use.

#### Request details

> **Method:** `POST`<br>**URL:** webhook URL provided by the partner<br>**Header:**

```http
Authorization: Basic base64(login:password)
Content-Type: application/json
```

**Request example**

```json
{
  "token": "pR3x...kLq9",
  "userId": "partner-user-10234",
  "status": "confirmed",
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
}
```

**Params**

| Field | Type | Description |
| --- | --- | --- |
| `token` | string | Token received when creating the link — to identify the request on the partner side |
| `userId` | string | The `userId` the partner passed when creating the link |
| `status` | string | Always `confirmed` for now |
| `card.cardId` | string | Main ID used in all subsequent operations |
| `card.number` | string | Masked card number — the full PAN is never sent |
| `card.balance` | integer | In tiyin (100 = 1 sum) |

## Receiver example — Python/FastAPI

```python
import base64
from fastapi import FastAPI, Header, HTTPException, Request

EXPECTED_LOGIN = "partner_webhook"
EXPECTED_PASSWORD = "..."  # agreed with Paylov

app = FastAPI()


@app.post("/paylov/card-bind/webhook")
async def card_bind_webhook(request: Request, authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Basic "):
        raise HTTPException(401)
    decoded = base64.b64decode(authorization[6:]).decode()
    login, password = decoded.split(":", 1)
    if login != EXPECTED_LOGIN or password != EXPECTED_PASSWORD:
        raise HTTPException(401)

    payload = await request.json()
    user_id = payload["userId"]
    card = payload["card"]
    # save card["cardId"] for this userId
    return {"ok": True}
```

Note

The webhook response must be `2xx`. If the partner side does not respond or returns an error, Paylov only logs it — there are no automatic retries for now. That is why the [status check](https://developer.paylov.uz/subscribe/card-bind/status) request is available as a fallback.

## Notes (extraction)
- Example owner is TEST USER in EN, ТЕСТОВЫЙ ПОЛЬЗОВАТЕЛЬ in RU, and TEST FOYDALANUVCHI in UZ. UZ Authorization example uses base64(login:parol); EN/RU use base64(login:password). Public sample token pR3x...kLq9 and Basic Auth login partner_webhook are preserved.
- Complete literal code/example differences for RU (including whitespace and translated comments):

```diff
--- EN code blocks
+++ RU code blocks
@@ -8,7 +8,7 @@
   "card": {
     "cardId": "b1e2f3a4-...-uuid",
     "userId": "partner-user-10234",
-    "owner": "TEST USER",
+    "owner": "ТЕСТОВЫЙ ПОЛЬЗОВАТЕЛЬ",
     "cardName": null,
     "number": "860012******9012",
     "balance": 1500000,
@@ -29,7 +29,7 @@
 from fastapi import FastAPI, Header, HTTPException, Request
 
 EXPECTED_LOGIN = "partner_webhook"
-EXPECTED_PASSWORD = "..."  # agreed with Paylov
+EXPECTED_PASSWORD = "..."  # согласовано с Paylov
 
 app = FastAPI()
 
@@ -46,5 +46,5 @@
     payload = await request.json()
     user_id = payload["userId"]
     card = payload["card"]
-    # save card["cardId"] for this userId
+    # сохраните card["cardId"] для этого userId
     return {"ok": True}
```
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -1,4 +1,4 @@
-Authorization: Basic base64(login:password)
+Authorization: Basic base64(login:parol)
 Content-Type: application/json
 
 {
@@ -8,7 +8,7 @@
   "card": {
     "cardId": "b1e2f3a4-...-uuid",
     "userId": "partner-user-10234",
-    "owner": "TEST USER",
+    "owner": "TEST FOYDALANUVCHI",
     "cardName": null,
     "number": "860012******9012",
     "balance": 1500000,
@@ -29,7 +29,7 @@
 from fastapi import FastAPI, Header, HTTPException, Request
 
 EXPECTED_LOGIN = "partner_webhook"
-EXPECTED_PASSWORD = "..."  # agreed with Paylov
+EXPECTED_PASSWORD = "..."  # Paylov bilan kelishilgan
 
 app = FastAPI()
 
@@ -46,5 +46,5 @@
     payload = await request.json()
     user_id = payload["userId"]
     card = payload["card"]
-    # save card["cardId"] for this userId
+    # card["cardId"] ni shu userId uchun saqlang
     return {"ok": True}
```
