---
source_url: https://developer.paylov.uz/subscribe/ofd/set-receipt
---

# Set Fiscal Receipt API

Attaches fiscal receipt details generated on the merchant side to a successfully paid Paylov transaction. This endpoint does not generate or send a new receipt to OFD.

> **Note:** The merchant must have the fiscalization API enabled and use client-side fiscalization.

## Endpoint

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/fiscalization/set-receipt/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

## Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `transactionId` | string (UUID) | Yes | Identifier of a successfully paid transaction belonging to the merchant |
| `externalId` | string | No | Unique external identifier of the receipt |
| `terminalId` | string | Yes | OFD terminal identifier; maximum 32 characters |
| `dateTime` | string | Yes | Receipt date and time in `YYYYMMDDHHMMSS` format |
| `fiscalSign` | string | Yes | Fiscal signature; maximum 64 characters |
| `qrCodeUrl` | string | Yes | Receipt URL using HTTPS and the `ofd.soliq.uz` domain |
| `receiptId` | integer | Yes | OFD receipt identifier; must be at least `1` |

## Request example

```json
{
  "transactionId": "e2da46c6-8c89-400e-8bd9-037297b2e8b1",
  "externalId": "merchant-receipt-12345",
  "terminalId": "EP000000000378",
  "dateTime": "20250915143025",
  "fiscalSign": "947030008479",
  "qrCodeUrl": "https://ofd.soliq.uz/epi?t=EP000000000378&r=173723",
  "receiptId": 173723
}
```

## Success response

```json
{
  "result": {
    "success": true,
    "error": null
  }
}
```

## Error response

```json
{
  "result": null,
  "error": {
    "code": "field_not_valid",
    "message": "field_not_valid",
    "data": {
      "field": "dateTime"
    }
  }
}
```

## Error codes

| Error code | Description |
| --- | --- |
| `validation_error` | A required field is missing or does not satisfy serializer constraints |
| `permission_denied` | Fiscalization is disabled or the merchant does not use client-side fiscalization |
| `field_not_valid` | `transactionId`, `dateTime`, or `qrCodeUrl` has an invalid format; `data.field` identifies the field |
| `external_id_already_exists` | A fiscal receipt with the supplied `externalId` already exists |
| `transaction_not_found` | The transaction does not exist or does not belong to the merchant |
| `receipt_not_available_for_operation` | The transaction has not been successfully paid |
| `ofd_check_already_generated` | A fiscal receipt has already been attached to the transaction |
| `ofd_too_many_requests_for_this_receipt` | Too many fiscal receipt attempts exist for the transaction |

## Notes (extraction)
- RU and UZ explicitly name the required fiscalization type `CLIENT_SIDE` in the prerequisite and `permission_denied` description; EN describes client-side fiscalization without naming the enum. Fields, constraints, flags, codes, URLs, and examples otherwise agree.
