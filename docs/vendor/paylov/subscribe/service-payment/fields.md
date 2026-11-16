---
source_url: https://developer.paylov.uz/subscribe/service-payment/fields
---

# Get Service Fields

Returns fields that service requires

**Request example**

> **Method:** `GET`<br>**URL:** BASE_URL/`servicePayment/fields/{service_id}/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

| Path param | Type | Description |
| --- | --- | --- |
| service_id | string | Service ID returned by the **servicePayment/list/** |

**Response example**

```json
{
  "result": {
    "data": [
      {
        "service_id": "6ae5eaf5-9b70-4aa9-9260-2438e99affa0",
        "name": "Плата за электроэнергию",
        "category": {
          "id": 33,
          "name": "Переводы"
        },
        "amount": {
          "min": 500,
          "max": 5000000
        },
        "has_info_method": true,
        "can_cancel": false,
        "payment_available": true,
         "is_active": true,
         "logo": "https://cdn.paylov.uz/2024/12/05/mobi.png",
        "fields": [
          {
            "field_id": "9",
            "name": "region",
            "title": "region",
            "type": "select",
            "content": "text",
            "validation": null,
            "length": null,
            "required": true,
            "dependency_of": null,
            "values": [
              {
                "id": 7,
                "value": "1",
                "title": "г. Ташкент",
                "filter": null
              },
              {
                "id": 8,
                "value": "2",
                "title": "Ташкентская область",
                "filter": null
              }
            ]
          },
          
           {
            "field_id": "10",
            "name": "soato",
            "title": "soato",
            "type": "select",
            "content": "text",
            "validation": null,
            "length": null,
            "required": true,
            "dependency_of": "region",
            "values": [
              {
                "id": 48,
                "value": "26280",
                "title": "26280 - Алмазарский ЭСП",
                "filter": "1"
              },
              {
                "id": 49,
                "value": "26264",
                "title": "26264 - Бектемирский ЭСП",
                "filter": "1"
              }
            ]
          },
          
           {
            "field_id": "11",
            "name": "customer_code",
            "title": "customer_code",
            "type": "text",
            "content": "number",
            "validation": null,
            "length": null,
            "required": true,
            "values": []
          }
        ],
        "response_fields": [
          {
            "field_id": "1311",
            "name": "fio",
            "title": "fio",
            "postfix": null
          },
          {
            "field_id": "1314",
            "name": "last_paid_date",
            "title": "last_paid_date",
            "postfix": null
          },
          {
            "field_id": "1315",
            "name": "last_paid",
            "title": "last_paid",
            "postfix": "UZS"
          },
          {
            "field_id": "1313",
            "name": "saldo",
            "title": "balance",
            "postfix": "UZS"
          },
          {
            "field_id": "1343",
            "name": "tariff_price",
            "title": "tariff_price",
            "postfix": null
          },
          {
            "field_id": "1344",
            "name": "kwn",
            "title": "kVts xisoblangani",
            "postfix": null
          }
        ]
      }
    ]
  }
}
```

**Explanation**<br> These returned fields can be separated into 2 groups by their type `text` and `select` types.

- if `type` is `select` then user should select one of the values that is returned in the “values” list field.

- if `type` is `text` and values field is empty it means it is user specific input like account number of a user in a service.

> when generating account field in `info` and `create` methods you need to get the required fields from here. and generate it like this:

```python
account = {}

for field in result['data']['fields']:

	if field['type'] == 'select':

		account[field['name']] = field['values'][0]['value']

	else:

		account[field['name']] = ''
	

# this is just an example to create account field correctly
```

`response_fields` - Lists the fields that may appear in the responses of the `info`, `create`, and `pay` methods. Note:

## Notes (extraction)
- The Python example indexes `result['data']['fields']`, although the JSON example shows `result.data` as an array. EN and RU end with an unfinished `Note:` / `Примечание:`; UZ omits that unfinished label. The electricity service example uses category `Переводы` and a `mobi.png` logo; this is preserved. EN, RU and UZ agree on fields, values, flags, and URLs. UZ reformats the JSON indentation and Python whitespace and translates the Python comment; the Python logic is unchanged.
