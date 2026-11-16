---
source_url: https://developer.paylov.uz/subscribe/service-payment/cancel
---

# Cancel Service Payment Transaction

Cancels a successfully paid Service Payment transaction.

> **Note:** The service provider must allow third-party cancellation, and the transaction must still be within the provider's cancellation period.

#### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL/`servicePayment/transaction/cancel/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `transactionId` | string | Yes | Unique identifier returned when the Service Payment transaction was created |

**Request example**

```json
{
  "transactionId": "b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26"
}
```

#### Response

On success, the API returns:

```json
{
  "error": null,
  "result": {
    "transactionId": "b6135bb4-ef3c-4ab1-a5aa-db174a9bdc26",
    "status": "cancelled",
    "cancelTime": "2025-12-31 11:24:03"
  }
}
```

#### Error response

```json
{
  "result": null,
  "error": {
    "code": "transaction_not_available_for_cancel",
    "message": "transaction_not_available_for_cancel"
  }
}
```

#### Error codes

- `validation_error`

- `gateway_not_working`

- `permission_denied`

- `transaction_not_found`

- `transaction_not_available_for_cancel`

- `processing_error`

- `card_not_found` (`unsupported_card_type` message)

## Notes (extraction)
- EN, RU and UZ agree.
