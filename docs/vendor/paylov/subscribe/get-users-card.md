---
source_url: https://developer.paylov.uz/subscribe/get-users-card
---

# Get User’s All Cards

### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL/`merchant/userCard/getAllUserCards/?userId=1`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

| Query | Type | Required |
| --- | --- | --- |
| userId | string | Yes |

## Response body

```json
{
  "result": {
    "cards": [
    {
		    "userId": "646",
        "cardId": "ede2c700-7611-4e01-b3af-ca7a0c111e4b",
        "owner": "Levi A.",
        "cardName": "card name",
        "number": "860003******9999",
        "balance": 1000000,  # tiyn
        "expireDate": "2612",
        "bankId": "14",
        "vendor": "Uzcard",
        "processing": "Uzcard",
        "status": {
            "sms_info": true, 
            "is_active": true, 
            "status_message": "active"
            }

    }
    ]
  }
}
```

## Notes (extraction)
- UZ adds that userId identifies the user whose cards are requested and moves the tiyin unit explanation out of the invalid JSON # comment into prose.
- Source JSON block is invalid JSON (Expecting property name enclosed in double quotes); preserved without correction.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -1,26 +1,27 @@
-Authorization: Bearer <ACCESS_TOKEN>
+Authorization: Bearer < ACCESS_TOKEN >
 
 {
   "result": {
     "cards": [
-    {
-		    "userId": "646",
+      {
+        "userId": "646",
         "cardId": "ede2c700-7611-4e01-b3af-ca7a0c111e4b",
         "owner": "Levi A.",
         "cardName": "card name",
         "number": "860003******9999",
-        "balance": 1000000,  # tiyn
+        "balance": 1000000,
         "expireDate": "2612",
         "bankId": "14",
         "vendor": "Uzcard",
         "processing": "Uzcard",
         "status": {
-            "sms_info": true, 
-            "is_active": true, 
-            "status_message": "active"
-            }
-
-    }
+          "sms_info": true,
+          "is_active": true,
+          "status_message": "active"
+        }
+      }
     ]
   }
 }
+
+
```
