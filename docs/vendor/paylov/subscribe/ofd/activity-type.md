---
source_url: https://developer.paylov.uz/subscribe/ofd/activity-type
---

# Activity Types

Retrieves fiscal receipt data from the fiscal system.<br>**Endpoint**

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/fiscalization/activity-types/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

## Request Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `pinfl` | `string` | Yes | Individual’s PINFL (JSHSHIR) |
| `activityType` | `int` | Yes | Type of activity to validate |

### Activity Types

| Value | Description |
| --- | --- |
| 1 | Checks whether it is an individual entrepreneur (YATT) |
| 2 | Checks whether the person is self-employed |
| 3 | Checks whether the income exceeds 100 million |

---

## Request example

```json
{
  "pinfl": "12345678901234",
  "activityType": 1
}
```

## Response example

**Activity Type: 1**

```json
{
    "result": {
        "success": false,
        "reason": "Ушбу ПИНФЛда ЯТТ аниқланмади",
        "data": 200
    }
}
```

**Activity Type: 2**

```json
{
    "result": {
        "success": true,
        "reason": "Success",
        "data": null
    }
}
```

**Activity Type: 3**

```json
{
    "result": {
        "success": true,
        "reason": "Success",
        "data": {
            "status": true,
            "activityNames": [
                "Lorem Ipsum is simply dummy text"
            ]
        }
    }
}
```

## Notes (extraction)
- EN and RU introductory text says this retrieves fiscal receipt data; UZ says it checks activity-type information. Request fields, required flags, activity values, income threshold, URLs, and example values agree. UZ uses different indentation in response examples. The example PINFL `12345678901234` is preserved as public vendor text; the response reason remains Uzbek Cyrillic in all locales. The income threshold does not specify currency or period.
