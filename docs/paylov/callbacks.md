---
sources:
  - https://developer.paylov.uz/merchants/paylov-payment-gateway
  - https://developer.paylov.uz/merchants/transaction-check
  - https://developer.paylov.uz/merchants/transaction-perform
  - https://developer.paylov.uz/merchants/statuses
  - https://developer.paylov.uz/merchants/auth
  - https://developer.paylov.uz/subscribe/payment/cancel-webhook
  - https://developer.paylov.uz/subscribe/card-bind/webhook
  - https://developer.paylov.uz/a2c/deposit-webhook
  - sandbox page bundle (internal checkout notes)
---

# Callbacks (inbound requests)

Paylov calls the merchant's server with five request kinds. No callback was observed live: no
callback URL was registered on DEV, so every fact on this page is D unless graded otherwise.

| Kind                  | Format                              | Trigger                                                 | Retries             | Merchant answer | Dedupe key       |
| --------------------- | ----------------------------------- | ------------------------------------------------------- | ------------------- | --------------- | ---------------- |
| `transaction.check`   | JSON-RPC 2.0 request                | Checkout payment, before it is performed                | None                | Status result   | —                |
| `transaction.perform` | JSON-RPC 2.0 request                | Checkout payment, after the customer confirms           | None                | Status result   | `transaction_id` |
| `transaction.cancel`  | JSON-RPC 2.0 notification (no `id`) | Cancellation in the business panel or by Paylov staff   | Up to 3, every 60 s | Any 2xx         | `transaction_id` |
| `merchant.deposit`    | JSON-RPC 2.0 notification (no `id`) | An A2C, Paynet or Munis deposit to the merchant account | Up to 3, every 60 s | Any 2xx         | `id`             |
| Card Bind             | Plain JSON                          | A card bound through a Card Bind link                   | None                | Any 2xx         | `token`          |

The sandbox bundle's internal-checkout page says "Paylov sends two webhook calls to your server
during this flow" and that "Webhook URL, username and password are configured by Paylov support"
(S). Its literal examples are a check and a perform request with the parameters below, integer ids
`1` and `3`, perform's `transaction_id` filled from the checkout's `checkId`, and the answer
`{"status": "0", "statusText": "OK"}` to both (S). They mention no retries, timeouts, failure
answers or signatures.

**Authentication:** every kind uses HTTP Basic auth with credentials agreed with Paylov. No
signature, HMAC or IP list is documented. The `/merchants/auth` page ("Basic Authorization") has no
body.

**Registration:** no API registers a callback URL. Paylov support attaches the URL and Basic
credentials to the merchant: checkout STEP 1 for check/perform, "attached to your merchant on the
Paylov side" for cancel and deposit, "stored in the merchant profile" for Card Bind. Nothing is sent
before. Whether the deposit webhook shares the check/perform URL and credentials is not documented.

**Request IDs for check/perform:** a JSON-RPC 2.0 string or number. No page names the protocol for
check and perform; this reads their examples, which carry `"jsonrpc": "2.0"`, an integer `id` and a
reply echoing it (D, S), with the cancel and deposit pages, which say "The request is sent as a
JSON-RPC 2.0 notification." (D).

**Answers to check/perform (M 2026-11-14):** Paylov goes on only after check answers `0` and
completes the payment only after perform answers `0`. Any other status, a non-2xx or unparseable
reply, or no reply stops it, and the customer is not charged or is refunded. Neither is retried. The
docs show only the `0` answer and link the status codes (D), and they name retries only for cancel
and deposit and none for Card Bind (D).

## transaction.check

Asks the merchant to validate a checkout payment before Paylov performs it.

| Name           | Type   | Description                                              |
| -------------- | ------ | -------------------------------------------------------- |
| `account`      | object | Merchant fields from the checkout link, e.g. `order_id`. |
| `amount`       | int    | Whole currency units (e.g. 500 UZS).                     |
| `amount_tiyin` | int    | Tiyin.                                                   |
| `currency`     | int    | `860` (UZS) or `840` (USD).                              |

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

Response:

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

The examples show `account` values as numbers; they arrive as strings (see
[checkout](checkout.md#link)). The unsigned link makes this the only place to re-validate amount,
currency and account against the merchant's order ([checkout security](checkout.md)). A tampered
`currency_id` makes `currency` 840, and `amount_tiyin` is then US cents. No rounding rule is stated
for the whole-currency `amount` of a payment that is not whole SUM; Paylov stores the exact tiyin (a
check of 100049 tiyin reads `amount` 1000.49 and `amount_in_tiyin` 100049 before and after payment,
W c1160, c1164). Callbacks carry the `account` keys sent when the transaction was created: the
cancel page says "Account fields sent when the transaction was created", and the check and perform
examples echo the link's `order_id` (D). No callback was observed live; DEV read checkout
transactions back with `account: {}`, in REST and GraphQL reads alike (W c346, c1159–c1165).

## transaction.perform

Asks the merchant to apply the payment after the customer confirms it. Same parameters as check,
plus `transaction_id` (UUID4). The response has the check shape. The check id of a checkout is the
REST transaction id (W c346, c352), and the sandbox bundle's perform example fills `transaction_id`
with it (S); no perform was observed live.

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

## Statuses

Check and perform answer with `result.status`, a string. No per-operation status sets are
documented.

| Status | Meaning                                                        |
| ------ | -------------------------------------------------------------- |
| `0`    | Success                                                        |
| `3`    | Maintenance is in process                                      |
| `5`    | Invalid amount                                                 |
| `303`  | Order not found                                                |
| `+1`   | Custom error; the merchant puts its own reason in `statusText` |

```json
{
  "jsonrpc": "2.0",
  "id": 1234567,
  "result": {
    "status": "+1",
    "statusText": "monthly_limit_exceeded"
  }
}
```

## transaction.cancel

Sent when a transaction is cancelled from the Paylov business panel or by Paylov processing staff.
The docs do not say whether an API `payment/cancel` also emits it.

```http
POST {webhook URL}
Authorization: Basic base64(username:password)
Content-Type: application/json
```

```json
{
  "jsonrpc": "2.0",
  "method": "transaction.cancel",
  "params": {
    "transaction_id": "9b3bd7be-9327-4608-b886-4353e49df05f",
    "status": "cancelled",
    "account": {
      "order_id": "12345"
    },
    "amount": 1500,
    "amount_in_tiyin": 150000,
    "cancel_time": 1767162243
  }
}
```

| Field             | Type   | Description                                           |
| ----------------- | ------ | ----------------------------------------------------- |
| `transaction_id`  | string | Paylov transaction ID.                                |
| `status`          | string | Always `cancelled`.                                   |
| `account`         | object | Account fields sent when the transaction was created. |
| `amount`          | int    | Whole UZS.                                            |
| `amount_in_tiyin` | int    | Tiyin.                                                |
| `cancel_time`     | int    | Unix seconds.                                         |

Return any 2xx; the body is not checked. A non-2xx answer or no answer (connect timeout 5 s, read
timeout 30 s) is retried up to 3 times at 60-second intervals, so the same notification may arrive
more than once; deduplicate on `transaction_id`.

The amount field is `amount_in_tiyin` here and in `merchant.deposit`, but `amount_tiyin` in check
and perform.

## merchant.deposit

Sent when Paylov adds an A2C, Paynet or Munis deposit to the merchant account; only incoming
deposits are notified.

```http
POST {webhook URL}
Authorization: Basic base64(username:password)
Content-Type: application/json
```

```json
{
  "jsonrpc": "2.0",
  "method": "merchant.deposit",
  "params": {
    "id": "6f1c2b7e-3d4a-5b8c-9e0f-1a2b3c4d5e6f",
    "merchant": "125",
    "type": "a2c",
    "amount_in_tiyin": 10000000,
    "create_time": 1767162243
  }
}
```

| Field             | Type   | Description                                                     |
| ----------------- | ------ | --------------------------------------------------------------- |
| `id`              | string | Deposit UUID.                                                   |
| `merchant`        | string | Merchant identifier; the example is the numeric string `"125"`. |
| `type`            | string | `a2c`, `paynet` or `munis`.                                     |
| `amount_in_tiyin` | int    | Tiyin; `10000000` is 100 000.00 UZS.                            |
| `create_time`     | int    | Unix seconds.                                                   |

Acknowledgement, retries and timeouts match [transaction.cancel](#transactioncancel). Deduplicate on
`id`.

## Card Bind webhook

Sent once after a card is bound through a [Card Bind](cards.md#card-bind) link.

```http
POST {webhook URL}
Authorization: Basic base64(login:password)
Content-Type: application/json
```

```json
{
  "token": "EXAMPLE-BIND-TOKEN",
  "userId": "partner-user-10234",
  "status": "confirmed",
  "card": {}
}
```

| Field    | Type   | Description                                                                  |
| -------- | ------ | ---------------------------------------------------------------------------- |
| `token`  | string | The token from create bind link.                                             |
| `userId` | string | The `userId` sent when the link was created.                                 |
| `status` | string | Always `confirmed`.                                                          |
| `card`   | object | The [card object](cards.md#card-object) with a flat `status` and `bankName`. |

The answer must be 2xx. Paylov only logs a failed delivery and does not retry; the
[bind session status](cards.md#bind-session-status) read is the fallback. Deduplicate on `token`.

## Deviations from vendor docs

- The `transaction-check` page's example (en, ru) lacks the comma after `account`; fixed.
- The gateway page's check parameter table names the currency field `curreny`; the
  `transaction-check` table and every example use `currency`.
- The gateway page's parameter tables are headed `| Name | Name | Description |`; the second column
  is the type.
- The status list is rendered as a table; values are unchanged.
- The Card Bind example is shortened to an empty `card`; the vendor example carries the full card
  object, described in the card object table.
- `account` values as strings, and the unsigned link, come from the checkout page bundle (L).
- The deposit webhook is documented on the A2C pages; it is listed here with the other callbacks.
