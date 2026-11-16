---
source_url: https://developer.paylov.uz/subscribe/service-payment/create
---

# Create Service Payment Transaction

Returns transactionId with a client account info of a service

#### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL`/servicePayment/create/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request fields**

| Field | sample_data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| service_id | 9f877739-bc25-4f0f-a13f-ec485fd04250 | string | Yes | service_id. |
| account | `{"soato": "26290", "region": "1", "customer_code": "1000000"}` | string | Yes | Fields required by the service should be included in the account field. |
| amount | 500 | int | Yes | amount in sum. |
| userId | 007 | string | No | userId (ID declared by the merchant) |
| cardId | 9f877739-bc25-4f0f-a13f-ec485fd04250 | string | No | If `cardId` is provided, it indicates that the payment will be processed with OTP confirmation. |
| phoneNumber | +998999999999 | string | No | field is used to verify whether it matches the phone number tied to the card. |
| sms |  | dict | No | SMS object for OTP details. |

**Request example without OTP (One Time Password)**

```json
{
  "amount": 500,
  "service_id": "9f877739-bc25-4f0f-a13f-ec485fd04250",
  "account": {
    "soato": "26290",
    "region": "1",
    "customer_code": "1000000"
  },
  "userId": "007"
}
```

**Response example without OTP**

```json
{
  "result": {
    "transactionId": "b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26",
    "data": [
      {
        "name": "region",
        "value": "г. Ташкент",
        "title": "region"
      },
      {
        "name": "soato",
        "value": "26290 - Яшнабадский ЭСП",
        "title": "soato"
      },
      {
        "name": "customer_code",
        "value": "1000000",
        "title": "customer_code"
      },
      {
        "name": "time",
        "value": "14.10.2024 15:01:07",
        "title": "time"
      },
      {
        "name": "fio",
        "value": "FIO - -",
        "title": "fio"
      },
      {
        "name": "address",
        "value": "Д******* Я******, 9***, 8",
        "title": "address"
      },
      {
        "name": "last_paid_date",
        "value": "2024-08-23",
        "title": "last_paid_date"
      },
      {
        "name": "pokcob",
        "value": "3431.28",
        "title": "bypass_indication"
      },
      {
        "name": "dateob",
        "value": "2024-10-08",
        "title": "bypass_date"
      },
      {
        "name": "last_paid",
        "value": "50000 UZS",
        "title": "last_paid"
      },
      {
        "name": "saldo",
        "value": "15105.15 UZS",
        "title": "balance"
      }
    ]
  }
}
```

**Request example With OTP (One Time Password)**

```json
{
"amount": 500,
"service_id": "9f877739-bc25-4f0f-a13f-ec485fd04250",
"account": {
  "soato": "26290", 
  "region": "1", 
  "customer_code": "1000000"
  },
"userId": "007",
"cardId": "string"
}
```

**Response example With OTP**

```json
{
  "result": {
    "transactionId": "b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26",
    "data": [
      {
        "name": "region",
        "value": "г. Ташкент",
        "title": "region"
      }, ....
      ],
    "sms": {"otpSentPhone": hidden_phone}
    }
 }
```

## Notes (extraction)
- The table types `account` as string, but request examples supply an object. The OTP response example contains `....` and unquoted `hidden_phone` and is invalid JSON. The public sample phone number `+998999999999` is preserved; example account identifiers and masked customer details are preserved.
- EN and RU share the malformed OTP response. UZ removes `....` and quotes `"hidden_phone"`, producing a valid response example with one data entry. UZ reformats the OTP request but retains its values. Fields, types, required flags, units (`sum`), URLs, and other example values agree.
