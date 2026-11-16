---
sources:
  - https://developer.paylov.uz/error-codes
  - https://developer.paylov.uz/subscribe/subscribe
  - https://developer.paylov.uz/subscribe/changes
---

# Errors

How Paylov shapes responses and reports errors, and the code catalogue. Grades follow the
[reference index](README.md#evidence).

## Response shapes

Every REST response, errors included, is `Content-Type: application/json` from `nginx`; no HTML
error page occurs, even for 404, 405, 413, 429 and 500 (W c012, c020, c024, c246, c336).

### Success shape by endpoint

| Shape      | Success body                               | Endpoints                                                                | Grade                                     |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------- |
| `envelope` | `{"result": <non-null>, "error": null}`    | Every REST endpoint not listed below, `receipts/create/` included        | W (c086 and every other captured success) |
| `flat`     | The record itself                          | `oauth2/token/`, `oauth2/revoke/`, `status/`, `onboarding/` GET and POST | W (c001, c002, c395); onboarding D        |
| `array`    | A bare JSON array                          | `bankList/`                                                              | W (c014)                                  |
| `raw`      | GraphQL `{"data": …}` or `{"errors": […]}` | `https://<graphql host>/graphql/`                                        | W (c340–c357)                             |

Envelope details:

- `result` may be a primitive: `true` on `deleteUserCard/` (W c324). No captured success has
  `result: null`.
- Extra keys appear: top-level `"is_cached": false` on `getCard/` and `getAllUserCards/` (W c052,
  c055, c056).
- Both `result` and `error` are present in every captured success and error (W, 80 successes).

### Error envelope

Every error, on every shape except GraphQL, is the envelope with a null `result`:

```json
{
  "result": null,
  "error": {
    "code": "insufficient_funds",
    "message": "There are insufficient funds on the card."
  }
}
```

Flat endpoints answer errors this way too: token (W c003–c013), revoke (W c374–c393) and onboarding
(W c359–c361, c365). Branch on `error` being non-null, never on the HTTP status: a 200 carries
GraphQL business errors and a 404 carries `card_not_found`.

GraphQL shapes and failures: [checkout error model](checkout.md#error-model) (W c342, c348, c349,
c351).

### Error object

| Field     | Type              | Description                                                      |
| --------- | ----------------- | ---------------------------------------------------------------- |
| `code`    | string            | Stable, lowercase `[a-z_]`. Branch on this.                      |
| `message` | string            | English text. Mostly fixed per code; a few carry detail (below). |
| `data`    | varies, or absent | Shape depends on the code (below).                               |

Messages that carry detail:

| Code                  | Message                                                                                                              | Grade                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `invalid_grant`       | The grant failure reason, e.g. "Invalid consumer secret"; the full list is in [authentication.md](authentication.md) | W (c003–c006, c010, c370, c371) |
| `field_required`      | `field_required: <field>`                                                                                            | W (c110)                        |
| `rate_limit_exceeded` | `Too many requests. Retry after <N>s.`                                                                               | W (c012, c904)                  |

`validation_error` messages are generic validator text ("This field is required.", "String should
have at least 14 characters") and never echo a request value (W, all 114 captured `validation_error`
responses).

### `data` shapes

| `data`                                               | Codes                                                                                                                                                                                                                                            | Grade                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Key absent                                           | Business codes, auth codes, `server_error`, `field_required`; `validation_error` sometimes                                                                                                                                                       | W (c015, c110, c209, c246) |
| `null`                                               | `not_found`, `method_not_allowed`, `payload_too_large`, `rate_limit_exceeded`                                                                                                                                                                    | W (c012, c013, c021, c336) |
| Field map `{"<field>": ["<message>"]}`               | `validation_error`                                                                                                                                                                                                                               | W (c009, c091)             |
| Nested index map `{"items": {"0": {"count": […]}}}`  | `validation_error` on array fields (OFD register, split)                                                                                                                                                                                         | W (c220, c270, c272)       |
| `{"non_field_errors": […]}`                          | `validation_error` for a wrong body type or a cross-field rule                                                                                                                                                                                   | W (c069, c302, c366)       |
| Character-offset key `{"14": ["JSON decode error"]}` | `validation_error` for malformed JSON                                                                                                                                                                                                            | W (c363, c364)             |
| Bare string                                          | `validation_error` (`"transactionId or externalId is required"`), `field_not_valid` (`"time"`), `service_not_found` (`""`)                                                                                                                       | W (c202, c249, c273)       |
| `{"field": "<name>"}`                                | `field_not_valid`                                                                                                                                                                                                                                | W (c096, c151, c265)       |
| Upstream object with Uzbek text                      | `gateway_not_working` from Didox                                                                                                                                                                                                                 | W (c318, c322)             |
| `{"sec_to_retry": <seconds>}`                        | `card_is_blocked` on card and PWR confirm                                                                                                                                                                                                        | W (c937, c948)             |
| Code-specific details                                | `card_temporarily_blocked` (`blocked_until`, `reason`), `card_not_active` (`is_active`, `status_message`, `sms_info`), `ofd_commitent_or_subcommission_not_active` (`itemIndex`, `tin`, `pinfl`), `recipient_not_found` (`notFoundRecipientIds`) | D                          |

Paylov documents `message` as display text, not for parsing (D).

## HTTP status

| HTTP | Codes                                                                                                                                                                                             | Grade                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 200  | Every success; every GraphQL business error                                                                                                                                                       | W                                |
| 201  | Sub-merchant create success                                                                                                                                                                       | D                                |
| 400  | Validation and business errors; `permission_denied` for a feature the merchant lacks; `invalid_request`, `unsupported_grant_type`, `invalid_token`, `invalid_or_expired`; GraphQL variable errors | W                                |
| 401  | `permission_denied`, `invalid_grant`; [authentication](authentication.md)                                                                                                                         | W (c003, c015–c019, c389, c400)  |
| 404  | `not_found`; [routing](authentication.md#bearer-failures)                                                                                                                                         | W (c021, c160, c243)             |
| 404  | `card_not_found`, `card_is_already_activated`; [cards](cards.md)                                                                                                                                  | W (c028, c034, c036, c048, c325) |
| 405  | `method_not_allowed`                                                                                                                                                                              | W (c013, c023, c058)             |
| 413  | `payload_too_large` for a body over 64 KB                                                                                                                                                         | W (c336)                         |
| 429  | `rate_limit_exceeded`: [token limit](authentication.md#rate-limit)                                                                                                                                | W (c012, c904)                   |
| 429  | `rate_limit_exceeded`: [sub-merchant limit](sub-merchants.md)                                                                                                                                     | D; W (c1455–c1469)               |
| 500  | `server_error`                                                                                                                                                                                    | W (c246, c253)                   |

Status-dependent codes:

| Code                | Statuses   | Meaning                                                         |
| ------------------- | ---------- | --------------------------------------------------------------- |
| `permission_denied` | 401        | The Bearer token was rejected; a new token fixes it             |
| `permission_denied` | 400, 403   | The merchant lacks the feature; only Paylov can enable it       |
| `card_not_found`    | 404 or 400 | Same meaning on every endpoint; the status differs per endpoint |

## Error code catalogue

New codes may appear. Endpoint pages own triggers; this catalogue groups codes and links to those
operations. Unless stated, HTTP status is 400. D-only codes are unobserved on DEV.

### Credentials and access

| Code                     | HTTP            | Meaning / endpoint triggers                                                                  | Grade                                                             |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `invalid_grant`          | 401             | [Token failures](authentication.md#token-failures)                                           | W (c003–c006, c010, c370, c371); activation, allowlist and lock D |
| `invalid_client`         | 401             | [Token failures](authentication.md#token-failures)                                           | W (c499)                                                          |
| `invalid_request`        | 400             | [Token failures](authentication.md#token-failures)                                           | W (c007, c011, c362)                                              |
| `unsupported_grant_type` | 400             | [Token failures](authentication.md#token-failures)                                           | W (c008)                                                          |
| `invalid_token`          | 400             | [Revocation](authentication.md#revoke-tokens)                                                | W (c375, c378, c380, c388)                                        |
| `invalid_or_expired`     | 400             | [Onboarding](authentication.md#onboarding)                                                   | W (c365)                                                          |
| `permission_denied`      | 401 / 400 / 403 | See [status-dependent codes](#http-status)                                                   | W (c015, c064, c294)                                              |
| `ip_not_allowed`         | 403             | The caller IP is not allowlisted; the token endpoint reports this as `invalid_grant` instead | D                                                                 |

### Request validation

These signal an integration bug; resending the same request fails the same way.

| Code                 | HTTP | Meaning / endpoint triggers                                                                             | Grade                |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------- | -------------------- |
| `validation_error`   | 400  | A field, the body type or JSON syntax is invalid; validation runs before permission and business checks | W (c009, c091, c361) |
| `field_required`     | 400  | A required field missing in a business check; the field is in the message                               | W (c110)             |
| `field_not_valid`    | 400  | A field value rejected by a business check                                                              | W (c096, c151, c202) |
| `method_not_allowed` | 405  | Wrong HTTP method                                                                                       | W (c013, c186)       |
| `not_found`          | 404  | Unknown route or undeployed feature                                                                     | W (c021, c077, c160) |
| `payload_too_large`  | 413  | Body over 64 KB                                                                                         | W (c336)             |

### Infrastructure

| Code                  | HTTP | Meaning / endpoint triggers                                                 | Grade          |
| --------------------- | ---- | --------------------------------------------------------------------------- | -------------- |
| `rate_limit_exceeded` | 429  | Too many requests; the delay is in the message and the `Retry-After` header | W (c012, c904) |
| `server_error`        | 500  | Unexpected server error                                                     | W (c246, c253) |

### Card

| Code                                   | HTTP      | Meaning / endpoint triggers                                                                    | Grade                                        |
| -------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `card_not_found`                       | 404 / 400 | [Cards](cards.md), [payments](payments.md), [holds](holds.md)                                  | W (c034, c048, c053, c108, c175, c207, c325) |
| `card_not_match`                       | 400       | [PAN binding](cards.md#create-user-card)                                                       | W (c032)                                     |
| `card_exists`                          | 400       | [PAN binding](cards.md#create-user-card)                                                       | W (c030)                                     |
| `card_is_already_activated`            | 404       | [Confirmation](cards.md#confirm-user-card)                                                     | W (c028)                                     |
| `card_is_not_for_this_check`           | 400       | [Saved-card payment](payments.md#pay-with-a-saved-card)                                        | W (c109)                                     |
| `phone_not_match`                      | 400       | [Phone check](cards.md#check-phone-match)                                                      | W (c041, c060)                               |
| `pinfl_not_match`                      | 400 / 403 | The PINFL does not match the cardholder                                                        | W (c049); 403 D                              |
| `link_expired`                         | 400       | [Card Bind](cards.md#card-bind)                                                                | W (c081)                                     |
| `link_already_used`                    | 400       | [Hosted bind page](cards.md#hosted-bind-page)                                                  | W (c1059), D                                 |
| `card_is_blocked`                      | 400       | [Card OTP](cards.md#otp-behavior), [PWR OTP](payments.md#confirm-payment-without-registration) | W (c937, c948)                               |
| `card_expired`                         | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `card_is_blocked_in_processing_center` | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `card_temporarily_blocked`             | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `card_not_active`                      | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `card_is_not_supported`                | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `card_not_found_in_processing_center`  | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `balance_refresh_error`                | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `invalid_card`                         | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `invalid_card_token`                   | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `pan_not_valid`                        | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `lost_card`                            | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `stolen_card`                          | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `card_captured`                        | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `restricted_card`                      | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `error_create_card`                    | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `sms_not_active`                       | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `card_phone_not_linked`                | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |
| `card_has_no_phone`                    | 400       | Issuer or processing-center refusals and card-state problems, as named                         | D                                            |

### OTP and PIN

| Code                    | HTTP | Meaning / endpoint triggers                                                                                                                     | Grade                |
| ----------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `invalid_otp`           | 400  | [Card OTP](cards.md#otp-behavior), [PWR OTP](payments.md#confirm-payment-without-registration), [checkout](checkout.md#internalcheckoutconfirm) | W (c026, c167, c342) |
| `otp_expired`           | 400  | [Card OTP](cards.md#otp-behavior), [PWR OTP](payments.md#confirm-payment-without-registration)                                                  | W (c169, c788, c789) |
| `otp_code_already_sent` | 400  | [Card OTP](cards.md#otp-behavior)                                                                                                               | W (c741)             |
| `try_new_otp`           | 400  | As named                                                                                                                                        | D                    |
| `incorrect_pin`         | 400  | As named                                                                                                                                        | D                    |
| `pin_attempts_exceeded` | 400  | As named                                                                                                                                        | D                    |
| `too_many_attempts`     | 400  | As named                                                                                                                                        | D                    |

### Funds and declines

| Code                             | HTTP | Meaning / endpoint triggers                                                                                     | Grade                            |
| -------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `insufficient_funds`             | 400  | [Payments](payments.md), [holds](holds.md), [checkout](checkout.md#internalcheckoutconfirm)                     | W (c127, c131, c357, c602, c615) |
| `invalid_amount`                 | 400  | [Payments](payments.md), [holds](holds.md), [checkout](checkout.md#internalcheckoutcreate), [splits](splits.md) | W (c177, c188, c335, c350)       |
| `processing_error`               | 400  | [Payment declines](payments.md#pay-with-a-saved-card) and [refunds](payments.md#cancel-refund-payment)          | W (c134, c135, c559)             |
| `limit_exceeded`                 | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `daily_limit_used_for_this_card` | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `insufficient_deposit`           | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `do_not_honor`                   | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `call_issuer`                    | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `transaction_not_permitted`      | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `duplicate_transaction`          | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `issuer_unavailable`             | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `invalid_merchant`               | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `merchant_not_available`         | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `error_at_pay`                   | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |
| `unknown_error`                  | 400  | Issuer, limit, deposit and merchant-configuration refusals, as named                                            | D                                |

### Transaction state and lookup

| Code                                    | HTTP | Meaning / endpoint triggers                                                                        | Grade                                                        |
| --------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `transaction_not_found`                 | 400  | [Payments](payments.md), [holds](holds.md), [fiscalization](fiscalization.md), [splits](splits.md) | W (c106, c115, c210, c211, c255)                             |
| `transaction_already_payed`             | 400  | [Saved-card payment](payments.md#pay-with-a-saved-card)                                            | W (c090)                                                     |
| `already_confirmed`                     | 400  | `confirmPayment/` on a saved-card `payment/` already confirmed or cancelled                        | W (c124, c130)                                               |
| `transaction_not_available_for_payment` | 400  | [Payments](payments.md), [holds](holds.md#charge), [RRN](transactions.md#get-rrn)                  | W (c118, c162, c193, c196, c201, c589, c632)                 |
| `transaction_not_available_for_cancel`  | 400  | [Refunds](payments.md#cancel-refund-payment)                                                       | W (c112, c114, c358, c565)                                   |
| `receipt_not_available_for_operation`   | 400  | [RRN](transactions.md#get-rrn), [fiscalization](fiscalization.md)                                  | W (c163); OFD D                                              |
| `external_id_already_exists`            | 400  | [Hold creation](holds.md#create), [receipt attachment](fiscalization.md#set-fiscal-receipt)        | W (c183); set-receipt D                                      |
| `hold_not_found`                        | 400  | [Dismiss](holds.md#dismiss)                                                                        | W (c197, c200, c339)                                         |
| `hold_time_expired`                     | 400  | [Charge](holds.md#charge)                                                                          | D; live run 2026-11-12 ([holds](holds.md#observed-behavior)) |
| `bank_not_found`                        | 400  | Unknown bank                                                                                       | D                                                            |

### Fiscalization

| Code                                        | HTTP | Meaning / endpoint triggers                                                                         | Grade          |
| ------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- | -------------- |
| `ofd_commitent_or_subcommission_not_active` | 400  | [Register](fiscalization.md#register-fiscal-receipt), [split](splits.md#create-split-payment)       | D              |
| `ofd_check_already_generated`               | 400  | [Register](fiscalization.md#register-fiscal-receipt), [attach](fiscalization.md#set-fiscal-receipt) | D              |
| `ofd_too_many_requests_for_this_receipt`    | 400  | [Attach](fiscalization.md#set-fiscal-receipt)                                                       | D              |
| `ofd_check_not_found`                       | 400  | [Receipt status](fiscalization.md#get-fiscal-receipt-status)                                        | W (c866, c876) |
| `ofd_error`                                 | 400  | [Register](fiscalization.md#register-fiscal-receipt)                                                | D              |
| `fiscal_receipt_not_generated`              | 400  | [Register](fiscalization.md#register-fiscal-receipt)                                                | D              |

### Splits and sub-merchants

| Code                              | HTTP | Meaning / endpoint triggers                        | Grade           |
| --------------------------------- | ---- | -------------------------------------------------- | --------------- |
| `split_already_done`              | 400  | [Split creation](splits.md#create-split-payment)   | D               |
| `split_not_found`                 | 400  | [Split status](splits.md#get-split-payment-status) | D               |
| `recipient_not_found`             | 400  | [Split creation](splits.md#create-split-payment)   | D               |
| `receipt_not_available_for_split` | 400  | The transaction cannot be split                    | D (legacy enum) |
| `sub_merchant_already_created`    | 400  | [Sub-merchants](sub-merchants.md)                  | D               |

### Gateway setup

| Code                      | HTTP | Meaning / endpoint triggers                                                                | Grade          |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------ | -------------- |
| `gateway_not_working`     | 400  | The merchant has no working gateway for the operation, such as an upstream fiscal provider | W (c318, c322) |
| `terminal_does_not_exist` | 400  | No terminal is available for the operation                                                 | W (c241)       |

### Holds

| Code                | HTTP | Meaning / endpoint triggers      | Grade    |
| ------------------- | ---- | -------------------------------- | -------- |
| `service_not_found` | 400  | [Hold creation](holds.md#create) | W (c208) |

## Codes outside the SDK

Codes for [additional surfaces](README.md#surface-outside-the-sdk).

- P2P transfers: `receiver_card_not_found`, `receiver_card_not_valid`,
  `receiver_card_bank_not_found`, `same_cards`, `can_not_transfer_same_card`,
  `sender_card_not_found`, `sender_card_not_active` (D).
- Didox: `didox_contract_not_found` (W c311, c320, c321).
- GraphQL account sign-in: integer `code` values such as 101 and 142 (S).

### Internal checkout (GraphQL)

Arrive in `errors[0].message` at HTTP 200. The mutations also return the shared codes
`invalid_amount`, `card_not_found`, `invalid_otp`, `insufficient_funds` and `server_error` (W c342,
c350, c353, c357, c795).

| Code                                 | Meaning / endpoint triggers                                                                                     | Grade                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------- |
| `merchant_not_found`                 | [Checkout creation](checkout.md#internalcheckoutcreate)                                                         | W (c348)             |
| `check_not_found`                    | [Checkout payment](checkout.md#internalcheckoutpayment)                                                         | W (c355)             |
| `check_is_not_available_for_payment` | [Checkout payment](checkout.md#internalcheckoutpayment) and [confirmation](checkout.md#internalcheckoutconfirm) | W (c344, c345)       |
| `card_is_blocked_try_again_later`    | [Checkout payment](checkout.md#internalcheckoutpayment) and [confirmation](checkout.md#internalcheckoutconfirm) | W (c954, c968)       |
| `currency_not_supported`             | [Checkout creation](checkout.md#internalcheckoutcreate)                                                         | W (c793, c797, c798) |

## Deviations from vendor docs

- The changelog envelopes every response except `oauth2/token/`, `oauth2/revoke/` and `onboarding/`.
  Live, `status/` is also flat, `bankList/` is a bare array, and `receipts/create/` is enveloped
  although its page shows a flat success (W c001, c014, c086).
- The docs show onboarding errors flat (`{"error": "invalid_or_expired"}`); live they are enveloped
  (W c365).
- Several examples omit `error` on success or `result` on failure; every captured response carries
  both.
- The docs make only `not_found` a 404 and every other business error a 400. Live, `card_not_found`
  (on create, confirm and delete) and `card_is_already_activated` are also 404 (W c028, c034, c048,
  c325).
- The docs give `permission_denied` as 401 or 400; live it is also 403 on card monitoring (W c294).
- The docs give `pinfl_not_match` as 403; on card confirm it is 400 (W c049).
- The docs give `data` as `{field}` for `field_required` and `field_not_valid`. Live,
  `field_required` has no `data` and names the field in its message (W c110); `field_not_valid` has
  `{"field": …}` or a bare string (W c096, c202).
- The docs' `validation_error` example `{"cardNumber": ["invalid_card_number"]}` was never observed;
  live messages are generic validator text.
- The ru and uz quick references list `token_required` for onboarding without a token; live that
  request is a `validation_error` (W c360). The code is not catalogued.
- The sub-merchant page tells clients to honor a `Retry-After` header; the token endpoint's 429
  sends one too, beside the delay in the message (W c904).
- The legacy page's error example has an inline `//` comment and a trailing `#` line (en, ru; uz
  states them as prose); its facts (`data` is a dict, string or null and may be absent) are kept as
  prose.
- The legacy enum's en and ru comments call `daily_limit_used_for_this_card` the card activation
  request limit and cap `ofd_too_many_requests_for_this_receipt` at more than 10 requests for a
  transaction; uz replaces them with generic glosses.
