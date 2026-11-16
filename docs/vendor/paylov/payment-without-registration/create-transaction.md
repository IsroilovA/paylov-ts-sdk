---
source_url: https://developer.paylov.uz/payment-without-registration/create-transaction
---

# Create Payment Transaction

## 📌 Fields

| Field | Sample Data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `amount` | `1000` | `int` | ✅ Yes | Amount in **SUM**. Example: `1000 = 1 Thousand SUM` |
| `cardNumber` | `9860000000000000` | `string` | ✅ Yes | Uzcard/Humo card number |
| `expireDate` | `3003` | `string` | ✅ Yes | Expiration date in `YYMM` format |
| `account` | `{ "field_name": "data" }` | `dict` | ❌ No | Additional data. Send an empty object if not used: `"account": {}` |

---

## 🔑 Request

**Endpoint details**

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/paymentWithoutRegistration/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request Body:**

```json
{
  "cardNumber": "8600030403000000",
  "expireDate": "2611",
  "amount": 10,
  "account": {
    "order_id": "123123"
  }
}
```

---

## 📥 Response

```json
{
  "result": {
    "transactionId": "42de5cf4-c744-44c0-9153-3fbd769ec042",
    "otpSentPhone": "********6466",
    "extId": null
  },
  "error": null
}
```

::: warning OTP is sent by the card processing center

- The OTP code is sent by the **Uzcard / Humo processing center**, not by Paylov or the merchant.
- The SMS goes to the phone number linked to the card (masked in `otpSentPhone`).
- The SMS sender is the processing center (e.g. `UZCARD` or `HUMO`), and the message text may not contain the merchant's name. In this case, contact Paylov staff: they will assign an SMS name to the merchant, and the merchant's name will additionally appear in the OTP SMS.
- If SMS notifications are not enabled for the card, the OTP will not be delivered.

**Recommendation:** before asking for the code, show the user a message like: *"The confirmation code will be sent by Uzcard/Humo to the phone number linked to your card: `********0000`."*

:::

---

## Notes (extraction)

- Public vendor card-number samples 9860000000000000 and 8600030403000000 are retained verbatim; masked phone ********6466 is retained.
- The `::: warning` block "OTP is sent by the card processing center" is the same text as on subscribe/create-user-card. Its recommended user message shows `********0000`, which does not match this page's response example `otpSentPhone` `********6466`.
- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes, example values and the OTP block; prose is localized. All code blocks are byte-identical across the three languages.
