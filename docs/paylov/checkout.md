---
sources:
  - https://developer.paylov.uz/creating-payment-link
  - https://developer.paylov.uz/merchants/creating-payment-link
  - https://developer.paylov.uz/merchants/paylov-payment-gateway
  - https://developer.paylov.uz/merchant-configuration (an empty redirect to /integration-overview;
    its last content is `docs/vendor/paylov/merchant/merchant-configuration.md` at commit 99d3b03)
  - checkout SPA bundle my.paylov.uz/my-assets/index.c9087fa0.js (route guard, return redirect)
  - checkout SPA bundle my.paylov.uz/my-assets/index.d4f12633.js, served on 2026-11-13 with
    Last-Modified 2026-11-10 (GraphQL endpoint constants)
  - sandbox page bundle (internal checkout mutations and webhook examples)
  - DEV GraphQL captures c340–c358 (2026-11-12) and internal-checkout captures cited below
---

# Checkout (hosted payment link and internal checkout)

A checkout link sends the customer to Paylov's hosted payment page. The merchant builds it locally
with no API call: a form-encoded query, base64-encoded and appended to a fixed URL. The page then
runs the internal-checkout GraphQL mutations described below. Here **L** is the checkout page
bundle: its route guard `Mce`, which parses the link, and the `internalCheckoutCreate` mutation it
calls.

| Step | Action                                                                                      | Direction                                                                    |
| ---- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1    | Merchant registers callback URL and Basic Auth credentials                                  | Merchant → Paylov (dashboard)                                                |
| 2    | Merchant generates the link                                                                 | Merchant → Customer                                                          |
| 3    | Customer opens the link; the page creates the check (`internalCheckoutCreate`)              | Customer → Paylov                                                            |
| 4    | Customer enters the card and the OTP (`internalCheckoutPayment`, `internalCheckoutConfirm`) | Customer → Paylov                                                            |
| 5    | Paylov validates the transaction                                                            | Paylov → Merchant ([`transaction.check`](callbacks.md#transactioncheck))     |
| 6    | Paylov performs the transaction                                                             | Paylov → Merchant ([`transaction.perform`](callbacks.md#transactionperform)) |
| 7    | Customer is redirected to `return_url`                                                      | Paylov → Customer                                                            |

The sandbox bundle's internal-checkout page says "Paylov sends two webhook calls to your server
during this flow" and shows a check request and a perform request whose `transaction_id` is the
check id (S; [callbacks](callbacks.md)). No callback was observed live: the DEV merchant has no
registered callback URL and still completes internal checkout (W c1159–c1165; confirm c1163).

> **Security:** the link is **not signed** (L). The page reads plain fields with no signature or
> hash parameter and takes `amount` and `account` as they arrive. Anyone who sees the link can
> change them and add or change `currency_id`. The merchant's `transaction.check` handler is the
> only tamper control: re-validate amount, currency and account against the merchant's order.

> **Return redirect:** the customer returns to `return_url` verbatim, with no status or transaction
> ID appended (L). Take the outcome from `transaction.perform` or a status call.

## Merchant setup

Configured with Paylov, not through the API. Callback registration is gateway STEP 1 (D); the other
items come only from the last content of `/merchant-configuration`, which serves no body (see
sources):

- Organization name, merchant name, merchant category, merchant logo (PNG).
- Accepted amount limits: minimum 500 SUM, maximum 100,000,000 SUM.
- Merchant requisites: fields shown on the customer's receipt (for example an `order_id` label).
- For check/perform callbacks: callback URL plus Basic Auth username and password.

## Link

```
GET https://my.paylov.uz/checkout/create/{base64_encoded_query}
```

The docs name only this host (D); the page runs against the production GraphQL endpoint (L), and DEV
checks report their `checkoutUrl` on this host too (W c792), so no DEV checkout page is known. Its
backend, the internal-checkout mutations, also runs on DEV (W c340–c345), so the check, payment and
confirm steps can be exercised there without the page.

| Name            | Type             | Required             | Description                                                                                                                                                                                                                                                                      |
| --------------- | ---------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| merchant_id     | UUID             | Yes                  | Merchant ID. The mutation declares `merchantId: UUID!`, so a non-UUID value fails when the page loads (W c349).                                                                                                                                                                  |
| account.<key>   | string           | Yes (D)              | Merchant order fields, flattened as `account.<key>=<value>`. They reach the mutation (`AccountType`) and the callbacks as strings, even where the docs show numbers. The mutation itself accepts an empty account (W c347).                                                      |
| amount          | integer          | Yes                  | SUM by default; minor units of the currency (tiyin for 860, cents for 840) when `amount_in_tiyin` is `True`. Parsed with `Number()` and sent as `BigInt!`, so a fractional SUM such as `1200.50` cannot be expressed: use minor units. `0` fails with `invalid_amount` (W c350). |
| amount_in_tiyin | `True` / `False` | No (default `False`) | Parsed case-insensitively with `JSON.parse(value.toLowerCase())`; `1` breaks the parse.                                                                                                                                                                                          |
| currency_id     | int              | No (default `860`)   | `860` UZS, `840` USD. The docs' Visa/Mastercard USD variant sends `amount_in_tiyin=True` with `currency_id=840`.                                                                                                                                                                 |
| convert_to      | int              | No                   | `860` or `840`; the page forwards it as `convertTo: Int` (L). Converted at the Central Bank of Uzbekistan rate current when the transaction is generated (D).                                                                                                                    |
| return_url      | URL              | Yes in practice      | Where the customer returns. Percent-encode it.                                                                                                                                                                                                                                   |

### Encoding rules (L)

The page runs `atob` on the path segment, splits the result on `&`, splits each pair on `=` keeping
only the first two parts, and **never percent-decodes**. Consequences:

- **Base64:** standard alphabet, appended raw, padding optional. base64url makes `atob` throw.
- **`return_url`:** must be percent-encoded. A raw `=` or `&` truncates it
  (`https://returnurl/?a=1&b=2` arrives as `https://returnurl/?a`). The encoded form survives
  because the router decodes the redirect query once.
- **Account keys and values:** keep them to `A-Z a-z 0-9 . _ -`. A raw `=` truncates the value, and
  any character the form encoding escapes reaches `transaction.check` still escaped (`a b` as `a+b`,
  `k=v` as `k%3Dv`, Cyrillic as `%D0%98...`), so it no longer matches what the merchant stored. The
  key `__proto__` is silently dropped, because the page assigns `account[key] = value`.

### Example

1. Query (D, abridged):
   `merchant_id=571c06fb-6c61-4ef7-8567-5511abaf12b5&amount=500&account.order_id=12`
2. Base64:
   `bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==`
3. Link:
   `https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==`

The vendor Python generator (`urllib.parse.urlencode`, then `base64.b64encode`) matches these rules.

### Page behavior

Opening the link returns no API response. The page calls `internalCheckoutCreate` with
`{merchantId, amount, account, currencyId, amountInTiyin, returnUrl, convertTo?}` and shows a
failure as `errors[0].message`, which holds a code such as `merchant_not_found` or `invalid_amount`
(W c348, c350). If the mutation returns `visaMasterLink`, the browser goes there (Visa/Mastercard
USD flow); otherwise to `/checkout/{check.id}?return_url=...` (L). The sandbox tester's mutation
document has neither `currencyId`, `convertTo` nor `visaMasterLink` (S); the schema declares all
three ([internalCheckoutCreate](#internalcheckoutcreate)).

## Internal checkout (GraphQL)

```
POST {GRAPHQL_URL}
Content-Type: application/json

{"operationName": "...", "query": "mutation ...", "variables": {...}}
```

DEV is `https://dev.app.paylov.uz/graphql/` (W c340); the production endpoint the checkout page is
configured with is listed under [hosts](README.md#hosts) (L). The three checkout mutations need **no
authentication**: the requests carried only `Accept` and `Content-Type` (W c340–c357). The public
merchant id is the only input, so anyone can create a check for any merchant.

`internalCheckoutPayment` takes a full card number and `internalCheckoutConfirm` the cardholder's
OTP. A merchant server that calls them receives and transmits cardholder data and is in PCI DSS
scope, unlike a merchant that sends customers to the hosted page.

### Error model

| Outcome                           | HTTP                                    | Body                                                                                                                                                                                                                                                                                                                                  | Grade                             |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Success                           | 200                                     | `data.<op>.success: true`, `errors: null`                                                                                                                                                                                                                                                                                             | W (c340, c341, c343)              |
| Business error                    | 200                                     | `data.<op>.success: false`; the code is in `errors[0].message`, `errors[0].code` is `null`; the result fields are `null`                                                                                                                                                                                                              | W (c342, c348)                    |
| Request rejected before execution | 400                                     | top-level `errors[{message, locations?, status_code: 200}]` without `path`, and no `data`. Seen for invalid JSON, a missing query, a syntax error, an unknown field, argument, type or operation, and a variable that is missing or does not coerce. `status_code` contradicts the HTTP status; `message` is English text, not a code | W (c349, c351, c799, c1089–c1095) |
| Resolver error                    | non-2xx, from the error's `status_code` | `errors[{message, locations, path, status_code}]` alongside `data` with the field `null`; seen as 401 `not_authenticated` on `transactionStatus`                                                                                                                                                                                      | W (c803)                          |

### internalCheckoutCreate

The schema declares (W c783, introspection):

```text
internalCheckoutCreate(
  account: AccountType!, amount: BigInt!, amountInTiyin: Boolean = false, convertTo: Int,
  currencyId: Int = 860, merchantId: UUID!, returnUrl: String
) → { success, message, errors: [ErrorType], check: CheckType, visaMasterLink: String }
```

`ErrorType` is `{message, code: Int, sec, secToRetry, data: String}`; `CheckType` includes `id`,
`state`, `isExpired`, `checkoutUrl`, `currency`, `amount`, `totalAmount`, `originalAmount` and
`convertedFrom`. No argument or input type carries an external id, and `externalId` is rejected as
an unknown argument (W c783, c799, c1400); a check whose account carried `external_id`, `externalId`
and `extId` keys reads back `external_id: null` ([transactions](transactions.md)).

```graphql
mutation InternalCheckoutCreate(
  $merchantId: UUID!
  $account: AccountType!
  $amount: BigInt!
  $amountInTiyin: Boolean
  $returnUrl: String
) {
  internalCheckoutCreate(
    merchantId: $merchantId
    account: $account
    amount: $amount
    amountInTiyin: $amountInTiyin
    returnUrl: $returnUrl
  ) {
    success
    message
    errors {
      code
      message
    }
    check {
      id
    }
  }
}
```

| Variable        | Type           | Required                                   | Description                                                                                                                                                              | Grade                      |
| --------------- | -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `merchantId`    | `UUID!`        | Yes                                        | Public merchant id; a non-UUID is an HTTP 400 variable error                                                                                                             | W (c349)                   |
| `account`       | `AccountType!` | Yes; `{}` accepted                         | Merchant order fields                                                                                                                                                    | W (c340, c347)             |
| `amount`        | `BigInt!`      | Yes; missing is an HTTP 400 variable error | SUM, or tiyin when `amountInTiyin` is `true`; `0` → `invalid_amount`                                                                                                     | W (c340, c347, c350, c351) |
| `amountInTiyin` | `Boolean`      | No (default `false`)                       | `true` with `amount` 50000 reads back as `amount_in_tiyin` 50000, `amount` 500.0                                                                                         | W (c347, c352)             |
| `returnUrl`     | `String`       | No                                         | Where the hosted page returns the customer                                                                                                                               | W (c340)                   |
| `currencyId`    | `Int`          | No (default `860`)                         | `840`, in SUM or cents mode, and `999` → `currency_not_supported` on the DEV merchant                                                                                    | W (c783, c793, c794, c797) |
| `convertTo`     | `Int`          | No                                         | On the DEV merchant, `currencyId: 840` with `convertTo: 860`, and `convertTo: 999`, → `currency_not_supported`; `currencyId: 860` with `convertTo: 840` → `server_error` | W (c783, c795, c796, c798) |

Success (W c340):
`{"data":{"internalCheckoutCreate":{"success":true,"message":null,"errors":null,"check":{"id":"<UUID>"}}}}`.
A plain UZS create returns `visaMasterLink: null`, `check.isExpired: false` and `check.checkoutUrl`
`https://my.paylov.uz/checkout/<check id>` (W c792, c1401). On the DEV merchant no conversion and no
USD check succeeds (W c793–c798, c1402–c1404). Which currencies and conversions a merchant gets is
merchant setup with Paylov (M 2026-11-15). After a conversion, the check and perform callbacks still
carry their own `currency` and `amount_tiyin` (D); with `convert_to` "the transaction will be
generated in the specified currency" (D), so they carry that currency at the converted amount (M
2026-11-15).

Codes: `merchant_not_found` (W c348), `invalid_amount` (W c350), `currency_not_supported` (W c793),
`server_error` (W c795). Behavior below or above the merchant's amount limits was not observed; 500
SUM succeeded (W c347).

`check.id` **is the REST transaction id**: `getTransactions` returns it with `via_link: true`,
status `created` before payment and `payed` after (W c346, c352). The `account` reads back as `{}`
although keys were sent, in the create response, `getCheck` and REST reads alike (W c346,
c1159–c1165). A paid checkout transaction cannot be cancelled through `payment/cancel/`: it answers
`transaction_not_available_for_cancel` and stays `payed`, although `getCheck` reports
`canCancel: true` (W c358, c1407, c1410, c1411), and it has no RRN (W c589). Refund it from the
Paylov business panel or through Paylov staff, the documented cancel paths (D,
[`transaction.cancel`](callbacks.md#transactioncancel)).

Check expiry is not enforced on DEV. Checks were paid 10 and 30 minutes after creation (W c414,
c715, c716; c415, c930, c931). A fresh unpaid check read `isExpired: false` and `state: 0` at every
poll up to 43 minutes after creation (W c828, c829, c858, c905, c912, c918, c924, c927, c929, c955,
c957, c959, c972, c1020, c1021, c1023, c1024, c1026, c1027, c1029, c1030, c1032, c1033,
c1039–c1049). A check created 24 hours earlier read `isExpired: true`, yet `internalCheckoutPayment`
and `internalCheckoutConfirm` paid it (`message: "paid"`); it then read `state: 4` and
`isExpired: false` (W c820, c824–c826). When the flag flips is unobserved.

### internalCheckoutPayment

Sends an OTP to the card's phone.

```graphql
mutation InternalCheckoutPayment($checkId: UUID!, $cardNumber: String!, $expiry: String!) {
  internalCheckoutPayment(checkId: $checkId, cardNumber: $cardNumber, expiry: $expiry) {
    success
    message
    cid
    otpSentMaskedPhone
    errors {
      code
      message
    }
  }
}
```

| Variable     | Type      | Description                                              | Grade          |
| ------------ | --------- | -------------------------------------------------------- | -------------- |
| `checkId`    | `UUID!`   | `check.id`                                               | W (c341)       |
| `cardNumber` | `String!` | Full PAN; UZCARD and HUMO both accepted                  | W (c341, c356) |
| `expiry`     | `String!` | `YYMM`; an `MMYY` expiry is rejected as `card_not_found` | W (c353, c356) |

Success (W c341, c356): `success: true`, `cid` (a UUID that becomes the paid transaction's
`card_id`, W c352), `otpSentMaskedPhone` (masked, e.g. `+9989*****00`).

Codes: `card_not_found` for an `MMYY` expiry or a number failing Luhn (W c353, c354),
`check_not_found` (W c355), `check_is_not_available_for_payment` for a paid check (W c345), and on
DEV `card_is_blocked_try_again_later` for a card blocked after wrong OTPs
([cards](cards.md#otp-behavior); W c954). The error’s `sec` and `secToRetry` were not selected in
these captures (W c954, c968).

A repeated call on an unpaid check issues a new `cid`, and the earlier one stays valid: confirming
the first `cid` paid the check, and the second then got `check_is_not_available_for_payment` (W
c804–c807).

### internalCheckoutConfirm

```graphql
mutation InternalCheckoutConfirm($checkId: UUID!, $cid: UUID!, $otp: String!) {
  internalCheckoutConfirm(checkId: $checkId, cid: $cid, otp: $otp) {
    success
    message
    errors {
      code
      message
    }
  }
}
```

Success (W c343): `{"success":true,"message":"paid","errors":null}`; `message` is the only state
signal.

Codes: `invalid_otp` for wrong OTPs 1 to 3, after which the same `cid` confirms with the right OTP
(W c342, c343, c965–c967); on DEV the 4th wrong OTP returns `card_is_blocked_try_again_later` and
the correct OTP is then refused the same way (W c968, c971); `check_is_not_available_for_payment` on
a second confirm (W c344); `insufficient_funds` for a declined card (W c357).

### Additional GraphQL operations

- `getCheck(id: ID)` answers **without authentication** with the check's `id`, `state`, `isExpired`,
  create, pay and cancel times, `amount` and `checkoutUrl` to anyone holding the check id (W c802,
  c819–c823). `transactionStatus(id)` answers HTTP 401 `not_authenticated` (W c803).
- `internalCheckoutMasterPayment(cardNumber, checkId, cvv, expiry, isMastercard = true)` returns
  `{isMastercard, masterUrl, success, errors, message, checkId}` (W c783). It takes a CVV and was
  never called.

### GraphQL account sign-in

`checkPhone`, `register`, `activate`, `login`, `confirm`, `refreshToken` and `me` (S) authenticate
an end-user Paylov app account with a phone, password and SMS OTP, not the merchant. No merchant
operation needs their token.

## Observed behavior

DEV live run 2026-11-12; no numbered capture.

- `internalCheckoutCreate` in tiyin (150000) read back through `getTransactions` as status
  `created`, `amount_in_tiyin` 150000 and `via_link: true`; `internalCheckoutPayment` and
  `internalCheckoutConfirm` with the Uzcard test card then made it `payed`, with a Tashkent `date`
  within a minute of the local clock.
- A second confirm answered `check_is_not_available_for_payment` and a create for a random merchant
  UUID `merchant_not_found`, both with HTTP 200; `payment/cancel` of the paid check answered
  `transaction_not_available_for_cancel`. All consistent with W c344, c348, c358.

## Deviations from vendor docs

- `convert_to` appears only on the merchants link page.
- The link pages mark `account` required; the gateway page lists `account.order_id` as an "Optional
  internal order reference".
- ru's link tables shift the `currency_id` (and on the merchants page `convert_to`) cells: the
  description reads "860 - UZS" and the Required cell "840 - USD", losing the optional flag and the
  `860` default that en and uz state.
- The docs show account values as numbers; L shows strings.
- `return_url` is missing from the docs' parameter table although every example uses it.
- The docs' step-1 prose lists an unencoded `return_url`, which the step-2 base64 omits; the
  encoding rules apply instead.
- The unsigned-link warning, the encoding rules and the bare return redirect come from L, not from
  the docs.
- The sandbox bundle describes the internal-checkout `expiry` as `MMYY`; the gateway accepts only
  `YYMM` (W c353, c356).
