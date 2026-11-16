---
source_url: https://developer.paylov.uz/payment-without-registration/confirm-payment
---

# Confirm Payment

## 📌 Fields

| Field | Sample Data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `transactionId` | `9f877739-bc25-4f0f-a13f-ec485fd04250` | `string` | ✅ Yes | Transaction ID returned from the previous request |
| `otp` | `123456` | `string` | ✅ Yes | 6-digit OTP sent to the cardholder |

---

## 🔑 Request

**Endpoint details**

**Method:** `POST`<br>**URL:** BASE_URL/`merchant/confirmPayment/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request Body:**

```json
{
  "transactionId": "42de5cf4-c744-44c0-9153-3fbd769ec042",
  "otp": "568068"
}
```

---

## 📥 Response

```json
{
  "result": {
    "status": "success",
    "transactionId": "42de5cf4-c744-44c0-9153-3fbd769ec042"
  },
  "error": null
}
```

## Notes (extraction)

- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
