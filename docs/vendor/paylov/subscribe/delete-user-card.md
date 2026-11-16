---
source_url: https://developer.paylov.uz/subscribe/delete-user-card
---

# Delete User Card

### Endpoint details

> **Method:** `DELETE`<br>**URL:** BASE_URL/merchant/`userCard/deleteUserCard/?**userCardId=78a3535a-c4f6-4287-sssf-2axxb3aadaaf**`<br>**Header:**

```http
Authorization: Bearer < ACCESS_TOKEN >
```

| Query | Type | Required |
| --- | --- | --- |
| userCardId | string | Yes |

## Success response

```json
{
  "result": true,
  "error": null
}
```

## Error response

```json
{
  "result": null,
  "error": {
    "message": "card_not_found",
    "code": "card_not_found"
  }
}
```

## Notes (extraction)
- UZ adds a prose explanation that userCardId identifies the card to delete. The example identifier contains non-UUID text “sssf” and “xx”, preserved.
