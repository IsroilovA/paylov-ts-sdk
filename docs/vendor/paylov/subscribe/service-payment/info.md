---
source_url: https://developer.paylov.uz/subscribe/service-payment/info
---

# Get Service Information

Returns client info of a service

Some services has a method that returns account info of a user in a service. ex: utility services.

The method returns information like balance, address, name, and/or other necessary info of an account.

**Endpoint details**

> **Method**: `POST`<br>**URL:** BASE_URL/`servicePayment/info/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request example**

| Fields | sample_data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| service_id | 9f877739-bc25-4f0f-a13f-ec485fd04250 | string | Yes | Service ID returned by the **servicePayment/list/** |
| account | `{"soato": "26290", "region": "1", "customer_code": "1000000"}` | dict | Yes | Fields required by the service |

```json
{
"service_id": "9f877739-bc25-4f0f-a13f-ec485fd04250",
"account": {"soato": "26290", "region": "1", "customer_code": "1000000"}
}
```

**Response example**

```json
{
  "result": {
    "data": [
      {
        "name": "time",
        "value": "14.10.2024 14:53:48",
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
      },
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
      }
    ]
  }
}
```

## Notes (extraction)
- EN, RU and UZ agree on fields, types, required flags, URLs, and example values. UZ reformats the request JSON with indentation and expands the account object onto multiple lines; EN and RU use the same compact formatting.
