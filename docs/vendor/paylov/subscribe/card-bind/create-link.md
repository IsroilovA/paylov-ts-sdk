---
source_url: https://developer.paylov.uz/subscribe/card-bind/create-link
---

# Create Bind Link

When the user taps "Add card", the partner backend requests a one-time bind link (`bindUrl`).

### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL`/merchant/userCard/createBindLink/`<br>**Header:**

```http
Authorization: Bearer < ACCESS_TOKEN >
Content-Type: application/json
```

## Request body

| Fields | Type | Required | Description |
| --- | --- | --- | --- |
| userId | string | Yes | User ID in the partner system (internal ID, set by the partner) |
| returnUrl | string | No | URL to return to after the webview is finished |

```json
{
  "userId": "partner-user-10234",
  "returnUrl": "https://partner-app.example/wallet/cards"
}
```

**Request example**

```bash
curl -X POST https://gw2.paylov.uz/merchant/userCard/createBindLink/ \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "partner-user-10234",
    "returnUrl": "https://partner-app.example/wallet/cards"
  }'
```

## Success response

```json
{
  "result": {
    "token": "pR3x...kLq9",
    "bindUrl": "https://my.paylov.uz/card-bind/?token=pR3x...kLq9",
    "expiresAt": "2026-10-30T12:20:00+00:00"
  },
  "error": null
}
```

| Field | Type | Description |
| --- | --- | --- |
| token | string | One-time token. Used to identify the request in the webhook and in the status check |
| bindUrl | string | Link to open in the webview |
| expiresAt | string | Link expiration time (ISO 8601) |

Note

`bindUrl` is one-time, valid for about 20 minutes and works for binding only one card. Request a new link every time a new card is bound.

## Fail response

```json
{
  "result": null,
  "error": {
    "code": "permission_denied",
    "message": "permission_denied"
  }
}
```

Next step: open `bindUrl` in a webview — [Card Bind](https://developer.paylov.uz/subscribe/card-bind/overview#opening-the-webview).

## Notes (extraction)
- EN, RU and UZ agree on fields, types, required flags, units, codes, URLs and examples; prose and labels are translated.
