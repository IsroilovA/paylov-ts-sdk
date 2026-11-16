---
source_url: https://developer.paylov.uz/subscribe/service-payment/pay
---

# Pay Service Transaction

Returns transaction id if transaction succeed

#### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL/`servicePayment/pay/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request Fields**

| Field | sample_data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| transactionId | b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26 | string | Yes | transactionId that is returned by the `/servicePayment/create/` method |
| cardId | 9f877739-2149-4831-88a4-d1857309c77c | string | Yes | cardId that is created in Paylov system |
| userId | 007 | string | No | userId (ID declared by the merchant) |
| otp | 123456 | string | No | field is used to verify the OTP (One-Time Password) sent during the `create` method.Required when cardId included in the `create` method |

**Request example**

```json
{
"transactionId": "b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26",
"cardId": "9f877739-2149-4831-88a4-d1857309c77c",
"userId": "007"
}
```

**Response example**

```json
{
  "result": {
    "transactionId": "b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26",
    "cardId": "9f877739-2149-4831-88a4-d1857309c77c",
    "payedAt": "2024-10-14 15:07:23", 
    "paymentRef": "023581615065", 
    "eposMerchant": "90510020873", 
    "eposTerminal": "92902804", 
  }
}
```

## Notes (extraction)
- The response has a trailing comma after `eposTerminal`, making the JSON invalid. The table marks `otp` No but describes it as required when `cardId` was included in create. The public sample OTP `123456` is preserved.
- RU translates the `otp` field name to `отп` in its table; EN and UZ use `otp`. EN and RU retain the response trailing comma; UZ removes it and reformats the request. Other fields, values, required flags, and URLs agree.
