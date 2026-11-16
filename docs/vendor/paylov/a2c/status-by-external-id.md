---
source_url: https://developer.paylov.uz/a2c/status-by-external-id
---

# Check Status by External ID

Returns the status of an A2C transaction by the merchant-side `externalId`.

### Endpoint

```http
GET {BASE_URL}/merchant/a2c/checkTransaction/byExternalId/{externalId}/
```

### Headers

```http
Authorization: Bearer <ACCESS_TOKEN>
```

### Path Parameters

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| externalId | string | Yes | Merchant-side external transaction ID sent in `performTransaction` |

### Success Response

```json
{
  "status": "0",
  "statusText": "SUCCESS",
  "amountInTiyin": 2500000
}
```

## Notes (extraction)

- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
