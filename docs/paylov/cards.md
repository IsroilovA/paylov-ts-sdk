---
sources:
  - https://developer.paylov.uz/subscribe/card-bind/overview
  - https://developer.paylov.uz/subscribe/card-bind/create-link
  - https://developer.paylov.uz/subscribe/card-bind/status
  - https://developer.paylov.uz/subscribe/card-bind/webhook
  - https://developer.paylov.uz/subscribe/create-user-card
  - https://developer.paylov.uz/subscribe/confirm-user-card
  - https://developer.paylov.uz/subscribe/delete-user-card
  - https://developer.paylov.uz/subscribe/get-users-card
  - https://developer.paylov.uz/subscribe/get-single-card
  - https://developer.paylov.uz/subscribe/check-phone-match
---

# Cards (Subscribe API)

A merchant binds a card to its own user id, without charging it, and later charges it by `cardId`
through [payments](payments.md) or [holds](holds.md). Every path is Bearer-authenticated
([authentication](authentication.md)) and starts with `{BASE_URL}/merchant/userCard/` (D). Error
codes: [catalogue](errors.md#card). Grades: [evidence](README.md#evidence).

## Flow

The merchant chooses one of two paths (D):

1. **Card Bind:** the merchant creates a one-time link; the cardholder enters the card and SMS code
   on a Paylov page; the merchant learns the `cardId` from the
   [webhook](callbacks.md#card-bind-webhook) or a [session read](#bind-session-status). The PAN
   never reaches the merchant. The session moves through `created`, `card_pending` and `confirmed`,
   and expires with the link, after which it cannot show whether a card was bound (W c1058, c1068,
   c1079).
2. **PAN binding:** the merchant backend sends the PAN and expiry
   ([`createUserCard/`](#create-user-card)), the card's processing center sends an SMS OTP, and the
   merchant confirms with it ([`confirmUserCardCreate/`](#confirm-user-card)); the `cid` returned
   first becomes the permanent `cardId` (W c025, c027). The PAN passes through the merchant. A
   rejected OTP can be corrected while it is valid; expiry and the per-card block follow the
   [OTP rules](#otp-behavior) (W c026–c029, c788, c937, c940).

[Card reads](#read-and-remove) expose issuer status and balance
([unit](README.md#amount-units-by-operation)). Deletion stops payments at once, but cached reads
return the card for a few seconds (W c327, c328, c1074, c1084–c1088).

## Card Bind

### Create bind link

`POST {BASE_URL}/merchant/userCard/createBindLink/`

| Field       | Type   | Required | Notes                                                                         | Grade          |
| ----------- | ------ | -------- | ----------------------------------------------------------------------------- | -------------- |
| `userId`    | string | Yes      | Merchant user id; an integer is coerced to a string                           | W (c080, c084) |
| `returnUrl` | string | No       | Where the page may redirect when it finishes; server-side validation untested | W (c083), D    |

Unknown keys are ignored (W c083). Success (W c082):

```json
{
  "result": {
    "token": "EXAMPLE-BIND-NOT-A-REAL-TOKEN",
    "bindUrl": "https://paylov.uz/card-bind/?token=EXAMPLE-BIND-NOT-A-REAL-TOKEN",
    "expiresAt": "2026-11-12T21:11:50.670112+05:00"
  },
  "error": null
}
```

| Field       | Notes                                                                                                                                                                                              | Grade          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `token`     | 43 base64url characters (`-` and `_` occur), embedded verbatim in `bindUrl`; identifies the session in the webhook and the status read                                                             | W (c082–c084)  |
| `bindUrl`   | Host per [README](README.md#hosts); the page completes binds against the production gateway only ([hosted page](#hosted-bind-page)). Needs no other credential, so it is as sensitive as the token | W (c082), L, D |
| `expiresAt` | ISO 8601 with microseconds and `+05:00`, creation plus 20 minutes                                                                                                                                  | W (c082), D    |

A link is single-use and binds one card. The page may redirect to `returnUrl`; redirect parameters
are undocumented, and the docs name the webhook, not the webview, as the result source (D). `{}`
returns `validation_error` on `userId` (W c080); a merchant without Card Bind gets 400
`permission_denied` (D).

### Bind session status

`GET {BASE_URL}/merchant/userCard/bindSession/{token}/status/`

The fallback when the [Card Bind webhook](callbacks.md#card-bind-webhook), which Paylov never
retries, does not arrive (D).

| `state`        | `card`                                                    | Grade        |
| -------------- | --------------------------------------------------------- | ------------ |
| `created`      | `null`                                                    | W (c085), D  |
| `card_pending` | absent or `null` (card entered, waiting for the SMS code) | D            |
| `confirmed`    | the card object, flat `status`                            | W (c1058), D |

```json
{ "result": { "state": "created", "card": null }, "error": null }
```

| Code                | HTTP | Trigger                                                                           | Grade               |
| ------------------- | ---- | --------------------------------------------------------------------------------- | ------------------- |
| `link_expired`      | 400  | Expired token, any unknown token, and a link that bound a card once it expires    | W (c081, c1079), D  |
| `link_already_used` | 400  | A card was already bound with this link; observed only on the hosted page's calls | W (c1059, c1060), D |
| `permission_denied` | 400  | Card Bind not enabled, or an invalid token                                        | D                   |

A link that bound a card reads `confirmed` until `expiresAt` (W c1058) and `link_expired` after it
(W c1079), so `link_expired` does not prove that no card was bound. The read never answered
`link_already_used` (W c1058, c1068, c1079). The `confirmed` card is the one the link bound, not a
fresh read: after `deleteUserCard/` the session still returns the deleted card (W c1068).
`getCard/{cardId}/` is the current state.

### Hosted bind page

The page behind `bindUrl` (route `/card-bind`, chunk `PCardBind`, L) calls an unauthenticated public
API on the gateway its build names, `https://gw2.paylov.uz` by default (L), not on the gateway that
issued the link. DEV serves the same calls:

| Call                                     | Body                                      | Answer                                                                  | Grade            |
| ---------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- | ---------------- |
| `GET /public/cardBind/{token}/`          | none                                      | `{state}`: `created`, then `confirmed`                                  | W (c1052, c1057) |
| `POST /public/cardBind/{token}/create/`  | `{cardNumber, expireDate}`, expiry `YYMM` | `{cid, otpSentPhone, code: null}`; an unknown card `404 card_not_found` | W (c1054, c1055) |
| `POST /public/cardBind/{token}/confirm/` | `{otp}`                                   | `{card}`: the card object, flat `status`                                | W (c1056)        |

Create and confirm on a confirmed link answer `400 link_already_used` (W c1059, c1060); after the
link expires every call answers `link_expired` (W c1080, c1081). The page ends on `link_expired` and
`link_already_used`, ends the OTP step on `otp_expired` and `try_new_otp`, and shows
`link_already_used` itself when the state reads `confirmed` (L).

A DEV `bindUrl` opened in a browser asks the production gateway, which answers the DEV token with
`link_expired`, so the page reports the link expired (live run 2026-11-14). A DEV link completes
only through the DEV calls above.

## PAN binding

### Create user card

`POST {BASE_URL}/merchant/userCard/createUserCard/`

| Field         | Type   | Required | Notes                                                                                                                                                                                                                                                                                 | Grade                                       |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `userId`      | string | Yes      | An integer is coerced                                                                                                                                                                                                                                                                 | W (c040)                                    |
| `cardNumber`  | string | Yes      | Full PAN, at least 16 characters; a bad Luhn digit, unknown BIN or non-UZ network is `card_not_found`, not a validation error                                                                                                                                                         | W (c034–c036)                               |
| `expireDate`  | string | Yes      | `YYMM`, year first, month `01`–`12`, at most 4 characters                                                                                                                                                                                                                             | W (c031, c033)                              |
| `phoneNumber` | string | No       | When sent it must equal the card's SMS phone, else `phone_not_match`; a bare 9-digit local number also mismatches                                                                                                                                                                     | W (c041, c042)                              |
| `sms`         | dict   | No       | `{hash?: string, templateId?: int}`: omitted, `{}`, `{hash}`, `{hash, templateId: 1}` and `{hash, templateId: 999999}` bound and confirmed alike; a non-integer `templateId`, a string or an array is `validation_error`. The docs give no description; what it changes is [OPEN Q29] | W (c725–c736, c1353–c1360, c1522, c1523), D |

Success (W c025, c029):

```json
{
  "result": {
    "cid": "5eed0000-0000-4000-8000-000000000001",
    "otpSentPhone": "+9989*****00",
    "code": null
  },
  "error": null
}
```

- `cid` is a UUID and becomes the permanent `cardId` once confirmed (W c027).
- `otpSentPhone` is a masked phone, present even without `phoneNumber`. DEV keeps the first five
  characters of `+998…`, five `*` and the last two digits; the docs show `********0000` and the
  sandbox bundle `+998901234***`. The mask is not a contract (W c025, c029; D; S).
- `code` is undocumented and `null` in every capture, with or without `sms` (W c025, c029, c1353,
  c1356, c1359).
- The same PAN may be bound under another `userId`, and re-bound after a delete (W c040, c332).

**Who sends the OTP (D).** The card's processing center (Uzcard or Humo) sends the OTP, not Paylov
or the merchant, to the phone linked to the card. The SMS sender is `UZCARD` or `HUMO` and the text
may lack the merchant's name; Paylov staff can assign the merchant an SMS name that then appears in
the message. A card without SMS notifications (`sms_info: false`) receives no OTP. The docs
recommend telling the cardholder before asking for the code, for example: "The confirmation code
will be sent by Uzcard/Humo to the phone number linked to your card: `********0000`."

| Code                                                                                                                                                                                                      | HTTP | Trigger                                                                                     | Grade                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------- | -------------------------- |
| `card_exists`                                                                                                                                                                                             | 400  | PAN already active for the same `userId`                                                    | W (c030)                   |
| `card_not_found`                                                                                                                                                                                          | 404  | Bad Luhn digit, unknown BIN, Visa PAN                                                       | W (c034, c036)             |
| `card_not_match`                                                                                                                                                                                          | 400  | Well-formed but wrong or expired expiry                                                     | W (c032)                   |
| `phone_not_match`                                                                                                                                                                                         | 400  | `phoneNumber` differs from the card's SMS phone                                             | W (c041, c042)             |
| `validation_error`                                                                                                                                                                                        | 400  | `expireDate` not `YYMM` or longer than 4; `cardNumber` under 16; missing fields             | W (c031, c033, c035, c037) |
| `otp_code_already_sent`                                                                                                                                                                                   | 400  | The same user and PAN while the previous OTP is still valid ([OTP behavior](#otp-behavior)) | W (c741)                   |
| `card_is_not_supported`, `card_not_active`, `sms_not_active`, `card_has_no_phone`, `card_phone_not_linked`, `daily_limit_used_for_this_card`, `card_temporarily_blocked`, `invalid_card`, `pan_not_valid` | 400  | See [card errors](errors.md#card) and [error data](errors.md#data-shapes)                   | D                          |

### Confirm user card

`POST {BASE_URL}/merchant/userCard/confirmUserCardCreate/`

| Field      | Type   | Required | Notes                                    | Grade          |
| ---------- | ------ | -------- | ---------------------------------------- | -------------- |
| `cardId`   | string | Yes      | The `cid`; must be a UUID                | W (c047)       |
| `otp`      | string | Yes      | An integer is coerced                    | W (c046, c051) |
| `cardName` | string | No       | Stored and echoed; `""` when omitted     | W (c027, c051) |
| `pinfl`    | string | No       | 14 characters; must match the cardholder | W (c049, c050) |

Success is `{"result": {"card": <card>}}` with a flat `status` (W c027, c045, c051, c962, c1354,
c1357, c1360). The docs say the status "might include error response" without a shape (D). Read with
the [get card](#get-single-card) example "Success response when card status not active"
(`is_active: false`, `status_message: "stolen_card_capture"`, D), that error is an inactive status
in the same flat shape, the reason in `status_message` (M 2026-11-15). Every observed success
carried an active status, and every observed failure was the error envelope (below).

| Code                        | HTTP | Trigger                                                                                                  | Grade                |
| --------------------------- | ---- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| `invalid_otp`               | 400  | Wrong code, up to the 3rd in a row                                                                       | W (c026, c934–c936)  |
| `card_is_blocked`           | 400  | The 4th wrong code and every confirm for the card during the block; `data` `{"sec_to_retry": <seconds>}` | W (c937, c940, c942) |
| `otp_expired`               | 400  | The OTP lifetime elapsed                                                                                 | W (c788)             |
| `card_is_already_activated` | 404  | Confirm repeated after success                                                                           | W (c028)             |
| `card_not_found`            | 404  | Unknown UUID                                                                                             | W (c048)             |
| `pinfl_not_match`           | 400  | PINFL differs from the cardholder's                                                                      | W (c049)             |
| `validation_error`          | 400  | Non-UUID `cardId`, missing `otp`, PINFL not 14 characters                                                | W (c046, c047, c050) |
| `try_new_otp`               | 400  | As named                                                                                                 | D                    |
| `too_many_attempts`         | 400  | As named                                                                                                 | D                    |
| `incorrect_pin`             | 400  | As named                                                                                                 | D                    |
| `pin_attempts_exceeded`     | 400  | As named                                                                                                 | D                    |

### OTP behavior

Observed on DEV; production may use other numbers. Times run from the create response on the client.

- Lifetime about 90 s: confirm worked at 61.5, 76.4, 80.7, 85.6 and 89.6 s (W c784, c787, c843,
  c845, c847) and returned `otp_expired` at 91.6 and 106.6 s and at 2, 5 and 10 minutes (W c788,
  c791, c462, c519, c718).
- A wrong code, a PINFL mismatch and validation failures leave the OTP usable (W c026–c029,
  c045–c051). After success the same OTP returns `card_is_already_activated` (W c028).
- Resend: `createUserCard/` for the same user and PAN returns `otp_code_already_sent` while the OTP
  is valid, at 5, 25, 61.7 and 80.6 s (W c741, c744, c839, c844). After expiry, at 96.6 and 130 s,
  it succeeds with the **same `cid`** and a new OTP that confirms (W c855, c857, c810, c811); that
  `cid` then reads `card_is_already_activated` (W c812).
- Attempt limit: wrong codes 1 to 3 return `invalid_otp`; the 4th returns `card_is_blocked` "Card is
  blocked try again later." with `data` `{"sec_to_retry": 298}` (W c934–c937). The block is per
  card, not per binding: the correct OTP is then refused the same way (W c940), and a new binding of
  the same PAN for another user is created but its correct OTP is refused (W c941, c942).
  `internalCheckoutPayment` refused the card during the block (W c954;
  [checkout](checkout.md#internalcheckoutpayment)), while
  [PWR confirm](payments.md#confirm-payment-without-registration) counted its own wrong OTPs. About
  5 minutes later a new binding confirmed (W c961, c962).

## Card object

Confirm, get, list, the confirmed bind session and the bind webhook return this object.

| Field        | Type           | Notes                                                                                  | Grade                   |
| ------------ | -------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| `cardId`     | string         | UUID used by every later call                                                          | W (c027)                |
| `userId`     | string         | The merchant user id, as a string                                                      | W (c027, c040)          |
| `owner`      | string         | Cardholder name from the processing center; personal data                              | W (c027)                |
| `cardName`   | string \| null | `""` when none was given; `null` in the Card Bind docs                                 | W (c027, c051), D       |
| `number`     | string         | Masked, first 6 and last 4 digits; the sandbox bundle shows 4 + 4                      | W (c027, c045), S       |
| `balance`    | int            | [Unit](README.md#amount-units-by-operation); DEV values reach about 2 × 10^13          | W (c052, c055), D       |
| `expireDate` | string         | `YYMM`                                                                                 | W (c027)                |
| `bankId`     | string         | Numeric-looking string                                                                 | W (c027)                |
| `bankName`   | string         | Present on confirm, get and list; absent from the docs' confirm, get and list examples | W (c027, c052, c055), D |
| `vendor`     | string         | `Uzcard`, `Humo` live; `MIR` and lowercase `uzcard` in the docs                        | W (c027, c045), D       |
| `processing` | string         | `Uzcard`, `Humo`                                                                       | W (c027, c045)          |
| `status`     | object         | `is_active` (boolean), `status_message` (string), `sms_info` (boolean); layout below   | W (c027, c052)          |

`status` layout per endpoint:

| Endpoint                 | Layout                     | Grade                |
| ------------------------ | -------------------------- | -------------------- |
| `confirmUserCardCreate/` | flat `status.{…}`          | W (c027, c045, c051) |
| `getCard/{cardId}/`      | nested `status.result.{…}` | W (c052), D          |
| `getAllUserCards/`       | nested `status.result.{…}` | W (c055)             |
| bind session `confirmed` | flat `status.{…}`          | W (c1058), D         |
| bind webhook             | flat in the docs example   | D                    |

`status_message` is `active` when `is_active` is true; see [status messages](#card-status-messages).

## Read and remove

### Get single card

`GET {BASE_URL}/merchant/userCard/getCard/{cardId}/`

Returns `{"result": {"card": <card>}}` with a refreshed balance, a nested `status` and top-level
`"is_cached": false` (W c052). An inactive card is a success with `is_active: false` and the reason
in `status_message` (D).

A read right after `deleteUserCard/` still returned the deleted card, with `"is_cached": true` (W
c1074); 30 s later it answered `card_not_found` (W c1076). `getAllUserCards/` caches the same way,
but for less time (see [Get user's cards](#get-users-cards)).

| Code                                                                                                                                                 | HTTP | Trigger                                                                              | Grade          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ | -------------- |
| `card_not_found`                                                                                                                                     | 400  | Unknown or deleted id                                                                | W (c053, c326) |
| `validation_error`                                                                                                                                   | 400  | Non-UUID id; the data key is `card_id`                                               | W (c054)       |
| `card_not_found_in_processing_center` (message `card_not_found`), `card_is_blocked_in_processing_center`, `card_is_blocked`, `balance_refresh_error` | 400  | As named; uz merges the two blocked rows into `card_is_blocked_in_processing_center` | D              |

### Get user's cards

`GET {BASE_URL}/merchant/userCard/getAllUserCards/?userId={userId}`

Returns `{"result": {"cards": [<card>, …]}}` with nested statuses (W c055); an unknown user returns
`{"cards": []}` (W c056). A missing `userId` is `validation_error` (W c057). The docs list no
errors.

Right after `deleteUserCard/` the list still contained the deleted card, with `"is_cached": true`,
for at least 5.6 s (W c1084–c1087). By 8.2 s it was empty, with `"is_cached": false` (W c1088). An
earlier list made after the delete was already empty (W c1075).

### Delete user card

`DELETE {BASE_URL}/merchant/userCard/deleteUserCard/?userCardId={cardId}`

Success is `{"result": true, "error": null}` (W c324); `false` was never observed. A deleted or
unknown card returns 404 `card_not_found` (W c325); a missing or non-UUID `userCardId` is
`validation_error` (W c329, c330). After a delete, payments with the card return `card_not_found` (W
c327, c328). `getCard/` also returns `card_not_found` (W c326), subject to the
[read cache](#get-single-card). A card that was never confirmed can be deleted, also after its OTP
expired (W c719–c721).

## Ownership checks

### Check phone match

`POST {BASE_URL}/merchant/userCard/checkPhoneMatch/`

| Field         | Type   | Required | Notes                                                                                            | Grade                |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------------------------ | -------------------- |
| `cardId`      | string | Yes      | Unknown id: 400 `card_not_found`                                                                 | W (c075)             |
| `phoneNumber` | string | Yes      | 7 to 15 characters. The docs call it `phone`, which the gateway rejects as missing `phoneNumber` | W (c059, c072, c076) |

Success (D only): `{"result": {"match": true}}`; the docs say a mismatch returns `false`. DEV
answered every phone with 400 `phone_not_match`, including the phone `createUserCard/` accepted for
the same card, on both networks and in every format (W c025, c060, c070–c074). Validation runs
before the card lookup (W c063, c075). A merchant without the feature gets `permission_denied` (D).

## Card status messages

`active`, `call_issuer`, `warm_card do_not_honor`, `honor_with_id`, `not_permitted`,
`lost_card_capture`, `stolen_card_capture`, `call_security_capture`, `invalid_card_capture`,
`pick_up_card_special_condition`, `call_acquirer_security`, `temporary_blocked_by_user`,
`pin_attempts_exceeded`, `forced_pin_change`, `credit_debts`, `unknown`, `pin_activation`,
`instant_card_personification_waiting`, `fraud_prevention`, `permanent_blocked_by_client`,
`temporary_blocked_by_client`, `decline_restricted_card`, `decline_card_not_effective`,
`pick_up_restricted_card`, `pick_up_special_conditions`, `pick_up_lost_card`, `pick_up_stolen_card`,
`decline_card_not_active_at_bank_will`, `decline_card_not_active_at_cardholder_will` (D). Only
`active` was observed (W c027, c052).

The source prints `warm_card do_not_honor` on one line, so it is either one value or the two values
`warm_card` and `do_not_honor`; the catalogue also lists `do_not_honor` as a decline code
([errors](errors.md)). The list is not closed.

## Observed behavior

DEV live runs 2026-11-12 and 2026-11-14; no numbered capture.

- `checkPhoneMatch/` with a fixed non-subscriber phone answered HTTP 400 `phone_not_match`, not
  `match: false` (2026-11-14).
- A new bind link's `expiresAt` lay 20 minutes after the local clock; its session read `created`
  with no card, and an unknown token `link_expired`, consistent with W c081, c082, c085.
- A repeated `deleteUserCard/` answered `404 card_not_found` and `getCard/` after the delete
  `400 card_not_found`, consistent with W c325, c326.

## Deviations from vendor docs

- `getAllUserCards/` nests `status.result` like `getCard/`; the docs show a flat status (W c055).
- `bankName` is present on confirm, get and list; the docs show it only on Card Bind (W c027, c052,
  c055).
- The confirmed bind session has `cardName: ""` and `vendor` `Uzcard`; the docs show
  `cardName: null` and lowercase `uzcard` (W c1058).
- The docs list `link_already_used` for the status read; the read answered a used link with
  `confirmed`, then `link_expired` (W c1058, c1079).
- `checkPhoneMatch/` requires `phoneNumber`; the docs name the field `phone` (W c059).
- `card_not_found`, `card_is_already_activated` and `pinfl_not_match` statuses differ from the docs:
  [errors](errors.md#deviations-from-vendor-docs) (W c028, c034, c048, c049, c053, c325).
- `bindUrl` points at `https://paylov.uz` on DEV, not `https://my.paylov.uz`; `expiresAt` carries
  microseconds and `+05:00`, not `+00:00` without a fraction (W c082).
- `createUserCard/` returns an undocumented `result.code: null` (W c025); `getCard/` and
  `getAllUserCards/` an undocumented top-level `is_cached`, `true` when the answer comes from a
  cache that still holds a deleted card (W c052, c055, c1074, c1085).
- The docs' `validation_error` example `{"cardNumber": ["invalid_card_number"]}` was not reproduced:
  an invalid PAN is `card_not_found` (W c034).
- The
  [get-single-card error table](../vendor/paylov/subscribe/get-single-card.md#error-codes-of-the-method)
  puts the `card_is_blocked` description in the Message column; moved to the trigger.
- PAN, PINFL, expiry, phone and bind-token literals are replaced with placeholders; masked PANs
  stay. Invalid JSON is fixed (trailing commas, `#` comments, the `# tiyn` comment);
  `Bearer < ACCESS_TOKEN >` spacing is normalized.
- The webview code samples and the webhook receiver example are omitted.
- ru renders the `active` and `unknown` status values as Russian prose; en and uz keep the codes.
- The sandbox bundle (S) shows a different mock card shape (`id`, a 4 + 4 `pan`, `isActive`) and
  labels the expiry MMYY while its own test data is YYMM. It is not contract.
