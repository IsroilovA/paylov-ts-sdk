---
source_url: https://developer.paylov.uz/subscribe/service-payment/list
---

# Get Services List

This method returns all available services

#### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL/`servicePayment/list/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

To retrieve the list of services available for your merchant, add the query parameter `available_for_me=true` to your request

> **Query params:**

```plaintext
BASE_URL/servicePayment/list/?available_for_me=true
```

**Response example**

```json
{
  "result": {
    "services": [
      {
        "service_id": "6ae5eaf5-9b70-4aa9-9260-2438e99affa0",
        "name": "Плата за электроэнергию",
        "category": {
          "id": 3,
          "name": "Коммунальные услуги"
        },
        "amount": {
          "min": 500,
          "max": 5000000
        },
        "is_active": true,
        "has_info_method": true,
        "can_cancel": false,
        "payment_available": true,
      },
      {
        "service_id": "d2369eff-a542-4d59-90d1-f00c76d0b4e4",
        "name": "Горячая вода и отопление",
        "category": {
          "id": 3,
          "name": "Коммунальные услуги"
        },
        "amount": {
          "min": 500,
          "max": 3000000
        },
        "is_active": true,
        "has_info_method": true,
        "can_cancel": false,
        "payment_available": true,
        "logo": "https://cdn.paylov.uz/2024/12/05/mobi.png"
      }
    ]
  }
}
```

## Notes (extraction)
- EN and RU response JSON contains a trailing comma after the first service’s `payment_available`; UZ removes that comma. Fields, values, flags, and units otherwise agree.
