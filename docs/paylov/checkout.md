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
with no API call: a form-encoded query, base64-encoded and appended to a fixed URL. The page runs
the internal-checkout GraphQL mutations described below. Here **L** is the checkout page bundle: its
route guard `Mce`, which parses the link, and the `internalCheckoutCreate` mutation it calls. Vendor
contracts: [link](../vendor/paylov/creating-payment-link.md),
[conversion](../vendor/paylov/merchants/creating-payment-link.md) and
[gateway flow](../vendor/paylov/merchants/paylov-payment-gateway.md). Grades:
[evidence](README.md#evidence).

## Flow

1. The merchant has Paylov register its callback URL and Basic credentials (gateway STEP 1, D;
   [callbacks](callbacks.md#delivery-contract)).
2. The merchant builds the [link](#link) and sends the customer to it.
3. The page creates the check (`internalCheckoutCreate`); it reads `created` and charges nothing (W
   c346, c352).
4. The customer enters the card (`internalCheckoutPayment`, which sends an OTP) and the OTP
   (`internalCheckoutConfirm`); the check reads `payed` (W c346, c352).
5. Paylov calls [`transaction.check`](callbacks.md#transactioncheck) and
   [`transaction.perform`](callbacks.md#transactionperform) (D, S). The DEV merchant has no callback
   URL and still completes internal checkout, so no callback was observed (W c1159–c1165; confirm
   c1163).
6. The customer returns to `return_url` (L).

> **Security:** the link is **not signed** (L). The page reads plain fields with no signature or
> hash parameter and takes `amount` and `account` as they arrive. Anyone who sees the link can
> change them and add or change `currency_id`. The merchant's `transaction.check` handler is the
> only tamper control: re-validate amount, currency and account against the merchant's order.

> **Return redirect:** the customer returns to `return_url` verbatim, with no status or transaction
> ID appended (L). Take the outcome from `transaction.perform` or a status read.

`check.id` **is the REST transaction id**: reconcile with a
[transaction read](transactions.md#get-one-transaction), which returns it with `via_link: true` (W
c346, c352). A paid check cannot be refunded through the API
([cancel](payments.md#cancel-refund-payment)) and has no [RRN](transactions.md#get-rrn) (W c358,
c589); refund it from the Paylov business panel or through Paylov staff (D,
[`transaction.cancel`](callbacks.md#transactioncancel)). [Business errors](#error-model) arrive at
HTTP 200. A repeated card step keeps the earlier `cid` valid ([payment](#internalcheckoutpayment)),
and check expiry is not enforced on DEV ([create](#internalcheckoutcreate)).

## Merchant setup

Configured with Paylov, not through the API. Besides the callback registration, the last content of
`/merchant-configuration`, which serves no body (see sources), lists these; their current
applicability is unverified:

- Organization name, merchant name, merchant category, merchant logo (PNG).
- Accepted amount limits: minimum 500 SUM, maximum 100,000,000 SUM. DEV check creation does not
  enforce them ([create](#internalcheckoutcreate)).
- Merchant requisites: fields shown on the customer's receipt (for example an `order_id` label).

## Link

```
GET https://my.paylov.uz/checkout/create/{base64_encoded_query}
```

Hosts: [README](README.md#hosts). No DEV checkout page is known, but the internal-checkout mutations
run on DEV without it (W c340–c345).

| Name            | Type             | Required             | Description                                                                                                                                                                                                                                                                      |
| --------------- | ---------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| merchant_id     | UUID             | Yes                  | Merchant ID. The mutation declares `merchantId: UUID!`, so a non-UUID value fails when the page loads (W c349).                                                                                                                                                                  |
| account.<key>   | string           | Yes (D)              | Merchant order fields, flattened as `account.<key>=<value>`. They reach the mutation (`AccountType`) and the callbacks as strings, even where the docs show numbers. The mutation itself accepts an empty account (W c347).                                                      |
| amount          | integer          | Yes                  | SUM by default; minor units of the currency (tiyin for 860, cents for 840) when `amount_in_tiyin` is `True`. Parsed with `Number()` and sent as `BigInt!`, so a fractional SUM such as `1200.50` cannot be expressed: use minor units. `0` fails with `invalid_amount` (W c350). |
| amount_in_tiyin | `True` / `False` | No (default `False`) | Parsed with `JSON.parse(value.toLowerCase())`; `1` produces a number rather than the GraphQL Boolean the mutation requires (L).                                                                                                                                                  |
| currency_id     | int              | No (default `860`)   | `860` UZS, `840` USD. The docs' Visa/Mastercard USD variant sends `amount_in_tiyin=True` with `currency_id=840`.                                                                                                                                                                 |
| convert_to      | int              | No                   | `860` or `840`; the page forwards it as `convertTo: Int` (L). Converted at the Central Bank of Uzbekistan rate current when the transaction is generated (D).                                                                                                                    |
| return_url      | URL              | Yes in practice      | Where the customer returns. Percent-encode it.                                                                                                                                                                                                                                   |

### Encoding rules (L)

The page runs `atob` on the path segment, splits the result on `&`, splits each pair on `=` keeping
only the first two parts, and **never percent-decodes**. Consequences:

- **Base64:** standard alphabet, appended raw, padding optional. The base64url characters `-` and
  `_` make `atob` throw.
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

Endpoints: [hosts](README.md#hosts) (L, W c340). The three checkout mutations need **no
authentication**: the requests carried only `Accept` and `Content-Type` (W c340–c357). The public
merchant id is the only input, so anyone can create a check for any merchant.

`internalCheckoutPayment` takes a full card number and `internalCheckoutConfirm` the cardholder's
OTP. A merchant server that calls them receives and transmits cardholder data, unlike one that sends
customers to the hosted page.

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
merchant setup with Paylov (M 2026-11-15). After a conversion the check and perform callbacks still
carry their own `currency` and `amount_tiyin` (D); with `convert_to` "the transaction will be
generated in the specified currency" (D), but which currency and amount the callbacks then carry is
neither documented nor observed.

Codes: `merchant_not_found` (W c348), `invalid_amount` (W c350), `currency_not_supported` (W c793),
`server_error` (W c795). DEV does not enforce the merchant-configuration amount limits on create: 1,
499 and 100,000,001 SUM each created a check, `state: 0`, whose `amount` and `totalAmount` read in
tiyin (100, 49900, 10000000100) (W c1595–c1597), as 500 SUM did (W c347). Whether payment of such a
check or production creation enforces them is unobserved.

The `account` reads back as `{}` although keys were sent, in the create response, `getCheck` and
REST reads alike (W c346, c1159–c1165). `getCheck` reports `canCancel: true` although
`payment/cancel/` refuses the paid check (W c358, c1407, c1410, c1411).

Check expiry is not enforced on DEV. Checks were paid 10 and 30 minutes after creation (W c414,
c715, c716; c415, c930, c931). A fresh unpaid check read `isExpired: false` and `state: 0` at every
poll up to 43 minutes after creation (W c828, c829, c858, c905, c912, c918, c924, c927, c929, c955,
c957, c959, c972, c1020, c1021, c1023, c1024, c1026, c1027, c1029, c1030, c1032, c1033,
c1039–c1049). A check created 24 hours earlier read `isExpired: true`, yet `internalCheckoutPayment`
and `internalCheckoutConfirm` paid it (`message: "paid"`); it then read `state: 4` and
`isExpired: false` (W c820, c824–c826). When the flag flips is unobserved.

### internalCheckoutPayment

Sends an OTP to the card's phone.

```text
internalCheckoutPayment(checkId: UUID!, cardNumber: String!, expiry: String!)
  → { success, message, cid, otpSentMaskedPhone, errors { code, message } }
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

```text
internalCheckoutConfirm(checkId: UUID!, cid: UUID!, otp: String!) → { success, message, errors { code, message } }
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
- The two link pages omit `return_url` from their parameter tables although their examples use it;
  the gateway integration page lists it.
- The docs' step-1 prose lists an unencoded `return_url`, which the step-2 base64 omits; the
  encoding rules apply instead.
- The unsigned-link warning, the encoding rules and the bare return redirect come from L, not from
  the docs.
- The sandbox bundle describes the internal-checkout `expiry` as `MMYY`; the gateway accepts only
  `YYMM` (W c353, c356).
