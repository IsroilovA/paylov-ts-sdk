---
source_url: https://developer.paylov.uz/merchants/paylov-payment-gateway
---

# Paylov Payment Gateway Checkout API Integration Guide

This document provides step-by-step instructions for integrating with the Paylov Payment System, including how to generate payment links, handle redirection, and process server-to-server payment status notifications.

## STEP 1: Register Callback URL

Before initiating transactions, the merchant must provide a callback URL where Paylov will send transaction updates.

### Required Details:

| Field | Description |
| --- | --- |
| Callback URL | Your server endpoint to receive payment notifications |
| Login | Merchant's API login |
| Password | Merchant's API password |

### Paylov uses Basic Authentication when posting to your callback URL.

Example callback URL:

```
 https://your-server-domain.com/payment/callback/
```

## STEP 2: Generate a Payment Link

Merchants generate a payment link with encoded parameters that customers open to proceed to the hosted Paylov payment interface.

#### Endpoint:

```
https://my.paylov.uz/checkout/create/{base64_encoded_params}
```

Remember

`my.paylov.uz` is used only for the Checkout API. For other APIs, use `BASE_URL`.

#### Example (base64-encoded):

```
https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9MmVmNGE4OTYtOGRhMi00OGE0LTlhZjMtMjYwN2U2OTIxMGVjJmFtb3VudD01MDAmY3VycmVuY3lfaWQ9ODYwJnJldHVybl91cmw9aHR0cHMlM0ElMkYlMkZnb29nbGUuY29tJmFtb3VudF9pbl90aXlpbj1UcnVlJmFjY291bnQub3JkZXJfaWQ9MTIzMw==
```

### Parameters (Base64-encoded query):

| Parameter | Description |
| --- | --- |
| merchant_id | Unique merchant identifier (UUID) |
| amount | Amount to be paid |
| currency_id | Currency code (860 for UZS, 840 for USD) |
| return_url | Redirect URL after payment completion |
| amount_in_tiyin | True if amount is in tiyin (UZS cents) |
| account.order_id | Optional internal order reference |

## STEP 3: Transaction Flow

### 1. Customer Redirection

After opening the payment link, the customer is redirected to the **Paylov payment interface**.

Upon successful or failed payment:

- The customer is redirected to the `return_url`.

- Your backend receives a **callback notification** for validation and processing.

### Server-to-Server Callbacks

Paylov sends two types of requests to your callback URL for validation and confirmation:

### transaction.check – Validate Transaction

Paylov uses this method to verify transaction details before performing the actual payment.

### Request Parameters

| Name | Name | Description |
| --- | --- | --- |
| account | dict | Merchant-defined fields (e.g., order_id) |
| amount | int | Amount in full currency (e.g., 500 UZS) |
| amount_tiyin | int | Amount in tiyin (e.g., 50000) |
| curreny | int | Currency code (860 = UZS, 840 = USD) |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "id": 1234567,
  "method": "transaction.check",
  "params": {
    "account": {
      "order_id": 12
    },
    "amount": 500,
    "amount_tiyin": 50000,
    "currency": 860
  }
}
```

### Example Response

```json
{
  "jsonrpc": "2.0",
  "id": 1234567,
  "result": {
    "status": "0",
    "statusText": "OK"
  }
}
```

For more status codes see [Status codes](https://developer.paylov.uz/merchants/statuses)

### transaction.perform – Finalize Transaction

This method is called by Paylov after the user confirms the payment.

### Request Parameters

| Name | Name | Description |
| --- | --- | --- |
| transaction_id | UUID4 | Unique transaction identifier |
| account | dict | Merchant-defined fields (e.g., order_id) |
| amount | int | Payment amount |
| amount_tiyin | int | Payment amount in tiyin |
| currency | int | 860 or 840 |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "id": 1234567,
  "method": "transaction.perform",
  "params": {
    "transaction_id": "9bd1a92b-5cce-47c8-a2df-99a20836ab9e",
    "account": {
      "order_id": 12
    },
    "amount": 500,
    "amount_tiyin": 50000,
    "currency": 860
  }
}
```

### Example Response

```json
{
  "jsonrpc": "2.0",
  "id": 1234567,
  "result": {
    "status": "0",
    "statusText": "OK"
  }
}
```

For more status codes see [Status codes](https://developer.paylov.uz/merchants/statuses)

## Summary of Integration Flow

| Step | Action | Direction |
| --- | --- | --- |
| 1 | Merchant provides callback + auth | Merchant → Paylov |
| 2 | Merchant generates payment link | Merchant → Customer |
| 3 | Customer opens link and pays | Customer → Paylov |
| 4 | Paylov validates transaction | Paylov → Merchant |
| 5 | Paylov performs transaction | Paylov → Merchant |
| 6 | Customer is redirected to return URL | Paylov → Customer |

## Notes (extraction)

- The callback tables repeat the column header Name. The transaction.check field is spelled curreny. Both are preserved. UZ status-code links point to the English /merchants/statuses; RU uses /ru/merchants/statuses.
- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
- Example block 1, EN versus UZ (including formatting/comment differences):

```diff
--- EN
+++ UZ
@@ -1 +1 @@
- https://your-server-domain.com/payment/callback/
+https://your-server-domain.com/payment/callback/
```
- Example block 2, EN versus UZ (including formatting/comment differences):

```diff

```
- Example block 3, EN versus UZ (including formatting/comment differences):

```diff

```
- Page link targets by language (including localized navigation within the content): EN: `https://developer.paylov.uz/merchants/statuses`, `https://developer.paylov.uz/merchants/statuses`; RU: `https://developer.paylov.uz/ru/merchants/statuses`, `https://developer.paylov.uz/ru/merchants/statuses`; UZ: `https://developer.paylov.uz/merchants/statuses`, `https://developer.paylov.uz/merchants/statuses`.
