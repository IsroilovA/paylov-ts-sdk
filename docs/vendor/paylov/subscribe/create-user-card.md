---
source_url: https://developer.paylov.uz/subscribe/create-user-card
---

# Create User Card

### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL/merchant/`userCard/createUserCard/`<br>**Header:**

```http
Authorization: Bearer < ACCESS_TOKEN >
```

## Request body

| Fields | Type | Required | Description |
| --- | --- | --- | --- |
| userId | string | Yes | user id generated from Merchant system |
| cardNumber | string | yes | 9860000000000000 |
| expireDate | string | yes | YYMM |
| phoneNumber | string | no | +998********* |
| sms | dict | no |  |

```json
{
  "userId": "string",
  "cardNumber": "string",
  "expireDate": "string",
  "phoneNumber": "string",
}
```

## Success response

```json
{
  "result": {
    "cid": "78a353ww-c4ff-42ee-qq0f-2a73baa5db4f",
    "otpSentPhone": "********0000"
  },
  "error": null
}
```

::: warning OTP is sent by the card processing center

- The OTP code is sent by the **Uzcard / Humo processing center**, not by Paylov or the merchant.
- The SMS goes to the phone number linked to the card (masked in `otpSentPhone`).
- The SMS sender is the processing center (e.g. `UZCARD` or `HUMO`), and the message text may not contain the merchant's name. In this case, contact Paylov staff: they will assign an SMS name to the merchant, and the merchant's name will additionally appear in the OTP SMS.
- If SMS notifications are not enabled for the card, the OTP will not be delivered.

**Recommendation:** before asking for the code, show the user a message like: *"The confirmation code will be sent by Uzcard/Humo to the phone number linked to your card: `********0000`."*

:::

## Error response

```json
{
  "result": null,
  "error": {
    "code": "validation_error",
    "message": "validation_error",
    "data": {
      "cardNumber": [
        "invalid_card_number"
      ]
    }
  }
}
```

## Notes (extraction)

- EN/UZ phoneNumber table example is +998*********; RU has +998******** (one fewer asterisk). The sms dict table field is absent from the request example in all versions. EN/RU request example has a trailing comma; UZ removes it. Public cardNumber example 9860000000000000 is preserved.
- Source JSON block is invalid JSON (Illegal trailing comma before end of object); preserved without correction.
- The `::: warning` block "OTP is sent by the card processing center" is present in EN, RU and UZ with the same facts: the Uzcard/Humo processing center sends the OTP, to the card's linked phone masked in `otpSentPhone`; the sender is `UZCARD` or `HUMO`; Paylov staff can assign an SMS name; no OTP without SMS notifications on the card; the recommended user message shows `********0000`.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -4,7 +4,7 @@
   "userId": "string",
   "cardNumber": "string",
   "expireDate": "string",
-  "phoneNumber": "string",
+  "phoneNumber": "string"
 }
 
 {
```
