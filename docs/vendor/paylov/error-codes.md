---
source_url: https://developer.paylov.uz/error-codes
---

# Error Codes

Every error response from the gateway has the same shape:

```json
{
  "result": null,
  "error": {
    "code": "insufficient_funds",
    "message": "There are insufficient funds on the card."
  }
}
```

- `error.code` — a stable, lowercase machine-readable identifier. **Check this in your code.**

- `error.message` — a human-readable description (English). For display only; do not parse it.

- Some errors include an optional `error.data` object with extra context (e.g. a field name or a `blocked_until` timestamp).

Important change

The gateway no longer returns **raw processing-center codes or text** (e.g. UzCard/Humo/Paynet numeric codes or provider messages). The same situation from different providers now maps to **one** unified `error.code` with a clear English message. If your integration previously matched on `processing_error` plus a raw code/text in `message`/`data`, switch to matching the specific `error.code` below.

## Card errors

| Code | Message | When it happens |
| --- | --- | --- |
| `card_not_found` | The card was not found. | The card id/token does not exist or does not belong to the merchant. |
| `card_expired` | The card has expired. | The card's expiry date has passed (provider decline). |
| `card_is_blocked` | The card is blocked. | The card is blocked by the issuer. |
| `card_is_blocked_in_processing_center` | The card is temporarily blocked. Please try again later. | The processing center temporarily blocked the card. |
| `card_temporarily_blocked` | The card is temporarily blocked. Please try again later. | Blocked by anti-fraud (e.g. too many attempts). `data.blocked_until`, `data.reason`. |
| `card_not_active` | The card is not active. | The card is not active in the processing center or SMS is off. `data`: `is_active`, `status_message`, `sms_info`. |
| `card_is_not_supported` | This card is not supported. | The card type/vendor is not supported for this operation. |
| `card_is_already_activated` | The card is already active. | Attempt to (re)activate an already active card. |
| `card_exists` | The card is already added. | The card is already registered for this user. |
| `invalid_card` | The card is invalid. | The card data is invalid. |
| `invalid_card_token` | The card token is invalid. | The supplied card token is invalid. |
| `pan_not_valid` | The card number is invalid. | The PAN failed validation. |
| `lost_card` | The card has been reported lost. | Provider decline: card reported lost. |
| `stolen_card` | The card has been reported stolen. | Provider decline: card reported stolen. |
| `card_captured` | The card cannot be used. Please contact your bank. | Provider decline: pick-up card. |
| `restricted_card` | Operations on this card are restricted. | Provider decline: restricted card. |

## Funds, limits and amount

| Code | Message | When it happens |
| --- | --- | --- |
| `insufficient_funds` | There are insufficient funds on the card. | Not enough money on the card. |
| `insufficient_deposit` | There is not enough deposit to complete the operation. | Merchant deposit / terminal deposit too low (A2C, service payment). |
| `invalid_amount` | The amount is invalid. | Amount out of allowed range or malformed. |
| `limit_exceeded` | The card limit has been exceeded. | Card/terminal limit exceeded (provider decline). |
| `daily_limit_used_for_this_card` | The daily limit for this card has been reached. | Daily card limit reached. |

## Transaction decline / processing

| Code | Message | When it happens |
| --- | --- | --- |
| `do_not_honor` | The transaction was declined by the card issuer. | Generic issuer decline (do not honor). |
| `call_issuer` | The transaction was declined. Please contact your bank. | Issuer asks the cardholder to contact the bank. |
| `transaction_not_permitted` | This transaction is not permitted for the card. | Operation not allowed for this card. |
| `duplicate_transaction` | A duplicate transaction was detected. | The provider detected a duplicate. |
| `issuer_unavailable` | The card issuer is temporarily unavailable. Please try again later. | Issuer/host temporarily unavailable. |
| `invalid_merchant` | The merchant configuration is invalid. | Merchant/terminal configuration problem. |
| `processing_error` | The payment could not be processed. Please try again. | Generic processing failure that does not map to a specific code. |
| `transaction_not_found` | The transaction was not found. | No transaction with the given id/externalId. |
| `transaction_not_available_for_payment` | `transaction_not_available_for_payment` | The transaction is not in a payable state. |
| `transaction_not_available_for_cancel` | `transaction_not_available_for_cancel` | The transaction cannot be cancelled. |
| `error_at_pay` | `error_at_pay` | Payment confirmation failed (generic wrapper). |

## Confirmation code (OTP) and PIN

| Code | Message | When it happens |
| --- | --- | --- |
| `invalid_otp` | The confirmation code is incorrect. | Wrong OTP code. |
| `otp_expired` | The confirmation code has expired. | OTP window elapsed. |
| `try_new_otp` | Please request a new confirmation code. | OTP verification failed; request a new one. |
| `otp_code_already_sent` | A confirmation code has already been sent. Please wait before requesting a new one. | An OTP was already sent recently. |
| `incorrect_pin` | The PIN is incorrect. | Wrong PIN (provider decline). |
| `pin_attempts_exceeded` | The number of PIN attempts has been exceeded. | Too many wrong PIN attempts. |
| `too_many_attempts` | Too many attempts. Please try again later. | Rate/attempt guard triggered. |

## Card phone / SMS

| Code | Message | When it happens |
| --- | --- | --- |
| `sms_not_active` | SMS notification is not active for this card. | The card has no active SMS/OTP capability. |
| `phone_not_match` | The phone number does not match the card. | Supplied phone does not match the card's phone. |
| `card_phone_not_linked` | No phone number is linked to this card. | No phone linked to the card. |
| `card_has_no_phone` | No phone number is registered for this card. | The card has no registered phone. |

## MyID / PINFL (identity verification)

Applies when the merchant has `is_myid_required` and/or `is_pinfl_required` enabled (e.g. A2C).

| Code | HTTP | When it happens |
| --- | --- | --- |
| `official_profile_required` | 403 | MyID is required but the user has no official profile. Create it via `/userCard/createOfficialProfile/`. |
| `merchant_user_myid_not_verified` | 400 | The merchant user does not exist / MyID not verified. |
| `pinfl_check_required` | 403 | PINFL is required but has not been verified for this card. |
| `pinfl_not_match` | 403 | The verified PINFL does not match the official profile / the card. |

## Service payment (Paynet / HGT / uzsuv / Hamkorbank / …)

Provider-specific numeric codes and provider text are **not** returned. They are unified below.

| Code | Message | When it happens |
| --- | --- | --- |
| `service_payment_error` | The payment could not be completed. Please try again. | Generic service-payment failure. |
| `account_not_found` | The account was not found. | Subscriber / account not found at the provider. |
| `provider_unavailable` | The service provider is temporarily unavailable. Please try again later. | Provider unreachable / overloaded / declined. |
| `service_under_maintenance` | The service is under maintenance. Please try again later. | Provider maintenance. |
| `payment_cancel_not_allowed` | This payment cannot be cancelled. | Cancellation not allowed / window expired at the provider. |
| `service_not_found` | The service was not found. | Service/product not found. |
| `service_not_available` | The service is temporarily unavailable. Please try again later. | Service temporarily unavailable. |
| `service_temporarily_not_accepting_payments` | `service_temporarily_not_accepting_payments` | The service is not accepting payments right now. |
| `pinfl_check_required` | see above | Some services require a verified PINFL before paying. |

## OFD / fiscalization

| Code | Message | When it happens |
| --- | --- | --- |
| `ofd_commitent_or_subcommission_not_active` | `ofd_commitent_or_subcommission_not_active` | The commitent (TIN) or sub-commission (PINFL) on a receipt item has no active contract in the OFD catalogue. `data`: `itemIndex`, `tin`, `pinfl`. |
| `ofd_check_already_generated` | `ofd_check_already_generated` | A fiscal receipt was already generated for this transaction. |
| `ofd_too_many_requests_for_this_receipt` | `ofd_too_many_requests_for_this_receipt` | Too many receipt requests for this transaction. |
| `ofd_check_not_found` | `ofd_check_not_found` | The fiscal receipt was not found. |

## Authorization, validation and generic

| Code | HTTP | When it happens |
| --- | --- | --- |
| `permission_denied` | 401 / 400 | Missing/invalid credentials, or the merchant lacks permission for this API (e.g. A2C, A2C-by-PAN, split, fiscalization). |
| `ip_not_allowed` | 403 | The caller IP is not in the merchant/key allowlist. |
| `validation_error` | 400 | The request body/params are invalid. `data` may contain per-field details. |
| `field_required` | 400 | A required field is missing. `data.field`. |
| `field_not_valid` | 400 | A field value is invalid. `data.field`. |
| `not_found` | 404 | The requested resource was not found. |
| `bank_not_found` | 400 | The bank was not found. |
| `terminal_does_not_exist` | 400 | No terminal is available for the operation. |
| `hold_not_found` | 400 | The hold was not found. |
| `gateway_not_working` | 400 | The merchant is not active / not configured for this gateway. |
| `rate_limit_exceeded` | 429 | Too many requests. |
| `payload_too_large` | 413 | The request body exceeds the size limit (64 KB). |
| `server_error` | 500 | An unexpected server error. |
| `unknown_error` | 400 | An unexpected error occurred. Please try again. |

INFO

This list covers the codes you are most likely to encounter. New codes may be added over time, so always handle an unknown `error.code` gracefully (treat it as a generic failure).

## Notes (extraction)

- pinfl_check_required appears in both the identity and service-payment tables. Several Message cells contain the machine code itself rather than a prose message; preserved.
- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
