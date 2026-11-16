---
source_url: https://developer.paylov.uz/subscribe/changes
---

# Changelog✈️

All notable changes to the gateway will be documented in this file.

New updates, improvements, and fixes will appear here with each release.

## Gateway upgrade

The payment gateway was rebuilt on a new engine. Endpoint paths, request fields and successful response shapes are **unchanged**. The items below may affect client code — everything else is an improvement.

### ⚠️ May require action

- **Authentication error `403` → `401`.** When credentials are missing or invalid, the status code is now `401`. If you check `if status == 403`, also handle `401` (best: `if status in (401, 403)`).

- **Responses always include both `result` and `error`.** Some endpoints previously returned only one. Now: success → `{"result": {...}, "error": null}`, failure → `{"result": null, "error": {...}}`. If you check `if "error" in response`, switch to `if response["error"] is not None`. (Exceptions kept flat: `oauth2/token/`, `oauth2/revoke/`, `onboarding/`.)

- **Processing-center errors now return a specific `error.code`.** Previously a declined card payment often returned `processing_error` with a raw processing code/text in `message`/`data`. Now it returns a specific unified code such as `insufficient_funds`, `card_expired`, `limit_exceeded`, `do_not_honor`, `lost_card`, etc., with an English message. Raw provider codes/text are **no longer** exposed. See **[Error Codes](https://developer.paylov.uz/error-codes)**. If you match on `processing_error`, add handling for the specific codes.

### Improvements

- `error.code` is always **lowercase**.

- **Unified errors across providers.** The same situation from UzCard / Humo / Paynet / other providers maps to one `error.code` with a clear English `message`. Service-payment errors no longer leak provider numbers/text in `error.data`.

- Some cases that used to return `500` now return a proper `400` with a code.

- Unknown routes and wrong HTTP methods now return the standard `{result, error}` format.

- Request body size limit: **64 KB** (`payload_too_large`).

### New error codes

- **OFD / fiscalization:** `ofd_commitent_or_subcommission_not_active` — a receipt item's commitent (TIN) or sub-commission (PINFL) has no active contract in the OFD catalogue (register & split). `data`: `itemIndex`, `tin`, `pinfl`.

- **A2C identity checks** (when the merchant has `is_myid_required` / `is_pinfl_required`): `official_profile_required`, `merchant_user_myid_not_verified`, `pinfl_check_required`, `pinfl_not_match`.

- **A2C by PAN** now requires the `uses_a2c_by_pan` permission — returns `permission_denied` if not enabled.

A full, categorized list is on the **[Error Codes](https://developer.paylov.uz/error-codes)** page.

## Notes (extraction)
- EN, RU and UZ agree on fields, types, required flags, units, codes, URLs and examples; prose and labels are translated.
