---
source_url: https://developer.paylov.uz/subscribe/check-pan-pinfl-match
---

# Check Pan Pinfl Match

Checks whether the card owner's PINFL matches the provided PINFL.<br> Returns true if they match, returns false if the PINFL is incorrect

### Endpoint Details

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/userCard/checkPinflMatch/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request Body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| cardId | string | Yes | Paylov cardId |
| pinfl | string | Yes | User PINFL |

**Example**

```json
{
  "cardId": "9630bd63-2149-4831-88a4-d1857309c88e",
  "pinfl": "52612000000009"
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
-          "match": true  # if matches true else false   
+    "match": true
   }
 }
 
```
