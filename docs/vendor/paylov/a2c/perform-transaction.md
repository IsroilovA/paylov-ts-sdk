---
source_url: https://developer.paylov.uz/a2c/perform-transaction
---

# Perform Transaction

Creates an A2C transaction and sends funds to the selected user card.

### Endpoint

```http
POST {BASE_URL}/merchant/a2c/performTransaction/
```

### Headers

```http
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

### Request Body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| amountInTiyin | integer | Yes | Transfer amount in tiyin |
| userId | string | Yes | User ID declared by the merchant |
| cardId | string | Yes | Card ID created in the Paylov system |
| externalId | string | No | Merchant-side external transaction ID |

```json
{
  "amountInTiyin": 2500000,
  "userId": "string",
  "cardId": "string",
  "externalId": "string"
}
```

### Success Response

```json
{
  "transactionId": "9bd1a92b-5cce-47c8-a2df-99a20836ab9e",
  "status": "0",
  "statusText": "SUCCESS"
}
```

| Field | Type | Description |
| --- | --- | --- |
| transactionId | string | A2C transaction ID |
| status | string | Transaction status code |
| statusText | string | Human-readable transaction status |

### Error Response

```json
{
  "result": null,
  "error": {
    "code": "insufficient_funds",
    "message": "There are insufficient funds on the card."
  }
}
```

### Error codes

Processing errors are returned as specific, unified codes (e.g. `insufficient_funds`, `card_expired`, `card_not_active`, `limit_exceeded`, `card_is_not_supported`) with an English `message`. Raw processing-center codes/text are not exposed.

A2C-specific:

- `permission_denied` — the merchant is not allowed to use A2C (or A2C by PAN — requires `uses_a2c_by_pan`).

- `card_not_found`, `card_not_active`, `phone_not_match`, `insufficient_deposit`.

- Identity checks (when `is_myid_required` / `is_pinfl_required` is enabled): `official_profile_required`, `merchant_user_myid_not_verified`, `pinfl_check_required`, `pinfl_not_match`.

- `card_temporarily_blocked` — blocked by anti-fraud; `data.blocked_until`, `data.reason`.

See the full **[Error Codes](https://developer.paylov.uz/error-codes)** reference.

## Notes (extraction)

- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
- Page link targets by language (including localized navigation within the content): EN: `https://developer.paylov.uz/error-codes`; RU: `https://developer.paylov.uz/ru/error-codes`; UZ: `https://developer.paylov.uz/uz/error-codes`.
