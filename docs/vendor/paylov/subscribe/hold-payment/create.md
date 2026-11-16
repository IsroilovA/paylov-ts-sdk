---
source_url: https://developer.paylov.uz/subscribe/hold-payment/create
---

# Create Hold

> **Method:** `POST`<br>**URL:** BASE_URL`/merchant/payment/hold/create/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

### Request body

| Field | Sample Data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| amount | 1000 | int | Yes | Amount in SUM (1000 = 1,000 SUM) |
| userId | 123 | string | No | User ID declared by the merchant |
| account | `{"field_name": "sample data"}` | dict | No | Send empty dict `{}` if no additional data |
| cardId | 9f877739-bc25-4f0f-a13f-ec485fd04250 | string | Yes | Card ID created in Paylov system |
| time | 10 | int | Yes | Hold time in minutes. Max: `40320` (28 days) |
| externalId | externalId1 | string | No | External ID. Max length: 64 characters |
| serviceId | 9f877739-bc25-4f0f-a13f-ec485fd04250 | string | No | Provided by the Payment System |

```json

{
  "userId": "string",
  "cardId": "string",
  "amount": 10,  # 10 = 10 Sum
  "account": {
    "additionalProp1": "string",
    "additionalProp2": "string",
    "additionalProp3": "string"
  },
  "time": 10,
  "externalId": "string", # max_chars: 64
  "serviceId": "uuid" 
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| userId | string | Yes | The unique identifier for the user. |
| cardId | string | Yes | The unique identifier for the card used in the hold. |
| amount | integer | Yes | The amount to be held. (amount in sum) |
| account | object | No | Contains additional properties for the account. |
| `account.additionalProp1` | string | Optional | Custom account data. |
| `account.additionalProp2` | string | Optional | Custom account data. |
| `account.additionalProp2` | string | Optional | Custom account data. |
| time | integer | Yes | The duration of the hold in minutes. The maximum allowed value is 28 days (40320 minutes). |

## Success response

```json

{
  "result": {
    "transactionId": "uuid4"
  }
}
```

| Field | sample_data | Type | Description |
| --- | --- | --- | --- |
| transactionId | uuid4 | string | The unique identifier for the user. |

## Notes (extraction)
- All versions mark userId optional in the first table and required in the second. EN/RU duplicate account.additionalProp2; UZ uses account.additionalProp3 for the second occurrence, matching the example. EN/RU describe transactionId as a user identifier; UZ calls it a transaction identifier. All versions specify amount in SUM and time in minutes, with maximum 40320 minutes (28 days). EN/RU example comments specify amount 10 = 10 Sum and externalId max_chars 64; UZ removes comments but retains the units and length in the table.
- Source JSON block is invalid JSON (Expecting property name enclosed in double quotes); preserved without correction.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -1,20 +1,18 @@
 Authorization: Bearer <ACCESS_TOKEN>
-
 
 {
   "userId": "string",
   "cardId": "string",
-  "amount": 10,  # 10 = 10 Sum
+  "amount": 10,
   "account": {
     "additionalProp1": "string",
     "additionalProp2": "string",
     "additionalProp3": "string"
   },
   "time": 10,
-  "externalId": "string", # max_chars: 64
-  "serviceId": "uuid" 
+  "externalId": "string",
+  "serviceId": "uuid"
 }
-
 
 {
   "result": {
```
