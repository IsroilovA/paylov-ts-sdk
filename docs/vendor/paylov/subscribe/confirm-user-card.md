---
source_url: https://developer.paylov.uz/subscribe/confirm-user-card
---

# Confirm User Card

### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL/merchant/`userCard/confirmUserCardCreate/`<br>**Header:**

```http
Authorization: Bearer < ACCESS_TOKEN >
```

## Request body

| Fields | Type | Required | Description |
| --- | --- | --- | --- |
| cardId | string | Yes | cid that is sent in “create user card” response |
| otp | string | Yes | SMS code |
| cardName | string | No |  |
| pinfl | string | No | The PINFL (Personal Identification Number of an Individual) associated with the card |

```json
{
  "cardId": "string",
  "otp": "string",
  "cardName": "string",
  "pinfl": "07803684736125"
}
```

## Success response

```json

{
  "result": {
    "card": {
      "userId": "1",
      "cardId": "78a353ww-c4ff-42ee-qq0f-2a73baa5db4f",
      "owner": "Levi A.",
      "cardName": "",
      "number": "860000******9999",
      "balance": 98280731,
      "expireDate": "2612",
      "bankId": "14",
      "vendor": "Uzcard",
      "processing": "Uzcard",
      "status": {
		      "sms_info": true, 
		      "is_active": true, 
		      "status_message": "active"
		      },
    }
  },
  "error": null
}
```

## Fail response

```json
{
  "result": null,
  "error": {
    "code": "card_is_already_activated",
    "message": "card_is_already_activated"
  }
}
```

> Status field might include error response

## Notes (extraction)
- The table calls cardId “cid”. EN/RU leave cardName description blank; UZ describes it as the card name. EN/RU response example has a trailing comma after the status object; UZ removes it.
- Source JSON block is invalid JSON (Illegal trailing comma before end of object); preserved without correction.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -6,7 +6,6 @@
   "cardName": "string",
   "pinfl": "07803684736125"
 }
-
 
 {
   "result": {
@@ -22,10 +21,10 @@
       "vendor": "Uzcard",
       "processing": "Uzcard",
       "status": {
-		      "sms_info": true, 
-		      "is_active": true, 
-		      "status_message": "active"
-		      },
+        "sms_info": true,
+        "is_active": true,
+        "status_message": "active"
+      }
     }
   },
   "error": null
```
