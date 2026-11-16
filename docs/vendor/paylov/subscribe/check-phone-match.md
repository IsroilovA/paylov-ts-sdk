---
source_url: https://developer.paylov.uz/subscribe/check-phone-match
---

# Check Pan Pinfl Match

Checks whether the given phone number belongs to the CARD or Not.<br> Returns true if they match, returns false if the phone number is incorrect

### Endpoint Details

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/userCard/checkPhoneMatch/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request Body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| cardId | string | Yes | Paylov cardId |
| phone | string | Yes | Phone Number |

**Example**

```json
{
  "cardId": "9630bd63-2149-4831-88a4-d1857309c88e",
  "phone": "+998912345678"
}
```

## Success response

```json
{
  "result": {
    "match": true  # if matches true else false   
  }
}
```

## Error response:

```json
{
  "error": {
    "code": "permission_denied",
    "message": "permission_denied"
  }
}
```

## Notes (extraction)
- EN/RU JSON response example contains a Python-style # comment; UZ moves the matching true/false explanation into prose.
- Source JSON block is invalid JSON (Expecting ',' delimiter); preserved without correction.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -7,7 +7,7 @@
 
 {
   "result": {
-    "match": true  # if matches true else false   
+    "match": true
   }
 }
 
```
