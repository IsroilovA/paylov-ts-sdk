---
sources:
  - https://developer.paylov.uz/subscribe/authorization
  - https://developer.paylov.uz/subscribe/changes
---

# Authentication

Onboarding, OAuth2 tokens, revocation, Bearer failures, and the two utility endpoints `status/` and
`bankList/`. Grades follow the [reference index](README.md#evidence); hosts are listed there too.

Four credentials stay server-side: the merchant-chosen `username` and `password` and the
Paylov-issued `consumer_key` and `consumer_secret` (D). The secret is shown once; report exposure to
Paylov for revocation (D).

Every REST call except onboarding, token, revoke and `status/` sends
`Authorization: Bearer <ACCESS_TOKEN>` (W c014, c015). No other API header, such as `api-key`, is
documented, and no REST call sends a `merchant_id`: the token identifies the merchant (D).

## Onboarding

A one-time operator step without authentication (W c359–c361, c365, c1100, c1101). Every failure is
the standard error envelope ([errors.md](errors.md#error-envelope)).

### Verify the token

`GET {BASE_URL}/merchant/onboarding/?token=<ONBOARDING_TOKEN>`

| Case                               | Answer                                                                                                                        | Grade           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Usable token                       | HTTP 200, flat `{"status":"ok"}`                                                                                              | D               |
| Consumed, expired or unknown token | 400 `invalid_or_expired`, message "Token is invalid or expired", no `data`; an unknown token of valid length answers the same | W (c365, c1100) |
| Token shorter than 8 characters    | 400 `validation_error`, `data` `{"token": [...]}`                                                                             | W (c359)        |
| No `token` parameter               | 400 `validation_error`, `data` `{"token": ["This field is required."]}`                                                       | W (c360)        |

### Complete onboarding

`POST {BASE_URL}/merchant/onboarding/?token=<ONBOARDING_TOKEN>` with a JSON body
`{"username": "...", "password": "..."}`.

- `token`, `username` and `password` each need at least 8 characters (W c361). The password also
  needs a lowercase and an uppercase letter, a digit and a special character (D).
- Field validation runs before the token lookup: a short token, username and password come back
  together as one `validation_error` map with all three keys, not as `invalid_or_expired` (W c361).
  Valid fields with an unknown token of valid length answer 400 `invalid_or_expired` "Token is
  invalid or expired" (W c1101).
- Success is HTTP 200, flat (D):

  ```json
  {
    "consumer_key": "app_EXAMPLE-CONSUMER-KEY",
    "consumer_secret": "EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL",
    "username": "EXAMPLE-USERNAME"
  }
  ```

- The token is single-use and `consumer_secret` is shown only once (D).
- The success shape and password-composition error are unobserved (D only).

The account stays inactive until Paylov activates it. Until then the password grant returns 401
`invalid_grant` "this account not activated" (D).

## Get access token

```http
POST {BASE_URL}/merchant/oauth2/token/
Authorization: Basic base64(consumer_key:consumer_secret)
Content-Type: application/json
```

```json
{
  "grant_type": "password",
  "username": "MERCHANT_USERNAME",
  "password": "PASSWORD_FROM_SECRET_MANAGER"
}
```

Success is HTTP 200 with exactly these flat keys, identical in every captured grant; lifetimes are
seconds (W c002, c367, c369, c381, c383, c385, c390, c391, c397, c398, c403):

```json
{
  "access_token": "EXAMPLE-ACCESS-TOKEN-NOT-A-REAL-CREDENTIAL",
  "refresh_token": "EXAMPLE-REFRESH-TOKEN-NOT-A-REAL-CREDENTIAL",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_expires_in": 2592000
}
```

The body must be a JSON object sent as `application/json` (W c363, c364, c366); null fields return
`validation_error` (D).

## Refresh token

Same endpoint and Basic header, body
`{"grant_type": "refresh_token", "refresh_token": "<REFRESH_TOKEN>"}`. The response matches the
password grant.

- A refresh rotates the refresh token: the old one fails at once with `invalid_grant` "Refresh token
  invalid or expired" (W c369, c370).
- A refresh with a wrong consumer key fails with `invalid_client` and does not consume the refresh
  token: the same token then refreshed with the right key (W c499, c500).
- A refresh may invalidate the old access token immediately, and no grace period can be assumed. On
  DEV, an access token never used before the refresh was rejected at once (W c513–c517), and one
  refreshed before use was rejected 7 s later (W c398, c400). Access tokens used before the refresh
  kept authorizing `bankList/` 5 s after one refresh (W c368, c372), for the whole 60 s poll after
  three others (W c428–c447, c452–c473, c478–c497), and up to 284 s after another, then failed from
  315 s on with 401 "Token invalid or expired" (W c533–c723, c742). One token was rejected 17 s
  after a refresh without a record of earlier use (W c389). The pattern fits a cache of validated
  tokens of about 5 minutes; the cache itself was not observed.
- A new password grant invalidates neither earlier access tokens nor earlier refresh tokens: after
  two grants, the first grant's access token still authorized, its refresh token refreshed, and the
  second grant's access token still authorized afterwards (W c394, c408, c423–c427).

## Token failures

All token failures are enveloped (W c003–c013).

| HTTP | Code                     | Message                                         | Cause                                                                                  | Grade          |
| ---- | ------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------- | -------------- |
| 401  | `invalid_grant`          | Invalid credentials                             | Wrong password or unknown username                                                     | W (c003, c004) |
| 401  | `invalid_grant`          | Invalid consumer secret                         | Wrong consumer secret                                                                  | W (c005)       |
| 401  | `invalid_grant`          | Invalid consumer key                            | Unknown consumer key, on the password grant                                            | W (c006)       |
| 401  | `invalid_grant`          | this account not activated                      | Paylov has not activated the account                                                   | D              |
| 401  | `invalid_grant`          | IP address not in whitelist                     | Source IP not allowlisted                                                              | D              |
| 401  | `invalid_grant`          | User account is locked                          | Too many failed password attempts                                                      | D              |
| 401  | `invalid_grant`          | Invalid refresh token                           | Unknown refresh token                                                                  | W (c010)       |
| 401  | `invalid_grant`          | Refresh token invalid or expired                | Rotated (already used) refresh token                                                   | W (c370)       |
| 401  | `invalid_grant`          | Not a refresh token                             | An access token sent as `refresh_token`                                                | W (c371)       |
| 401  | `invalid_grant`          | Refresh token expired, User credential inactive | Expired refresh token, inactive credential                                             | D              |
| 401  | `invalid_client`         | Invalid consumer key                            | Refresh grant with a wrong consumer key; the refresh token stays usable                | W (c499, c500) |
| 400  | `invalid_request`        | Basic Authorization header required             | No Basic header                                                                        | W (c007, c362) |
| 400  | `invalid_request`        | Invalid Authorization header format             | Malformed Basic value                                                                  | D              |
| 400  | `invalid_request`        | username and password required                  | Password grant without credentials                                                     | D              |
| 400  | `invalid_request`        | refresh_token required                          | Refresh grant without `refresh_token`                                                  | W (c011)       |
| 400  | `unsupported_grant_type` | Grant type '...' is not supported               | Any other `grant_type`                                                                 | W (c008)       |
| 400  | `validation_error`       |                                                 | `{}` body: `data` `{"grant_type": [...]}`                                              | W (c009)       |
| 400  | `validation_error`       |                                                 | Malformed JSON: `data` keyed by character offset, e.g. `{"14": ["JSON decode error"]}` | W (c363, c364) |
| 400  | `validation_error`       |                                                 | Form-encoded body: `data` `{"non_field_errors": [...]}`                                | W (c366)       |
| 405  | `method_not_allowed`     | Method not allowed.                             | `GET`; `data` `null`                                                                   | W (c013)       |
| 429  | `rate_limit_exceeded`    | Too many requests. Retry after <N>s.            | Rate limit (below); `data` `null`; the same delay in a `Retry-After` header            | W (c012, c904) |

Failed password attempts lock the account after an undocumented threshold (D); keep token attempts
few.

## Rate limit

- The token endpoint limited the 11th POST of two bursts with 429. The 11th request within 17 s,
  after 9 failures, got "Too many requests. Retry after 42s." (W c002–c012); its headers were not
  recorded. Ten successful password grants in about 13 s were followed by "Too many requests. Retry
  after 48s." with the header `retry-after: 48` (W c894–c904). In both, the elapsed time plus the
  delay is about 60 s from the first request, consistent with about 10 requests per 60 s.
- The 429 carries the delay in the message and, where headers were recorded, in `Retry-After` (W
  c904). The 200 grant responses carry no rate-limit headers (W c894–c903). A grant 53 s after the
  429 succeeded (W c908).
- A `GET` to the token endpoint one second after the 429 got 405, not 429 (W c013). At up to 8 token
  calls per 60 s nothing was limited (W c362–c403), and no other endpoint was limited in about 400
  calls (W).
- The limit's window and key (source IP or credential), and whether failed grants count differently,
  are undocumented. Neither docs baseline documents a limit for this endpoint.

## Revoke tokens

`POST {BASE_URL}/merchant/oauth2/revoke/` with `Content-Type: application/json` and the body
`{"token": "<ACCESS_TOKEN>"}`. No `Authorization` header is needed.

- `token` is the only accepted key: `{"access_token": ...}` is `validation_error` (W c387).
  `token_type_hint` is tolerated (W c386).
- Success is HTTP 200, flat `{"status": "success"}` (W c395, c407, c502).
- Revocation has no observable effect on DEV. A revoked access token kept authorizing `bankList/`
  right after and 7 s later (W c396, c408), after every revoke with or without a header (W c503,
  c505, c507, c511), when it was revoked before its first use (W c520, c522–c526), and 19.5 minutes
  after the revoke (W c532, c534–c925).
- Production: a successful revoke stops the access token authorizing at once (M 2026-11-14); no
  production revoke has been observed. A revoked token can no longer be used (D).
- Only access tokens can be revoked (D). A failed revoke of a refresh token leaves it usable for
  later refreshes (W c381, c385, c403).
- Revoking an access token leaves its refresh token valid until a refresh rotates it or it expires.
  This reads "Only an `access_token` can be revoked" (D); the docs revoke a refresh token only on
  rotation, and leaked credentials only through Paylov support (D).
- The header outcome is not stable. Header-less revokes succeeded (W c395, c407), and every revoke
  sent with a Bearer or Basic header failed with `invalid_token` (W c376, c378–c380, c384, c386,
  c388, c393). Revokes with a Bearer header carrying the same token and with the Basic header also
  succeeded (W c502, c510), so the header alone does not cause `invalid_token`.

| HTTP       | Code                                                                | Cause                                    | Grade                      |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------- | -------------------------- |
| 400        | `invalid_token` "Token not found or already revoked"                | Unknown token                            | W (c375, c393)             |
| 400        | `invalid_token`                                                     | A refresh token                          | W (c380, c384, c401)       |
| 400        | `invalid_token`                                                     | An access token whose pair was refreshed | W (c388)                   |
| 400 or 200 | `invalid_token` or `{"status": "success"}`; not stable              | The same token revoked again             | W (c378; c502, c504, c508) |
| 400        | `validation_error`, `data` `{"token": ["This field is required."]}` | `{}` body                                | W (c374)                   |
| 405        | `method_not_allowed`, `data` `null`                                 | `GET`                                    | W (c382)                   |

## Bearer failures

Any endpoint that needs a token rejects it with HTTP 401 and `permission_denied`, with no `data`.

| Trigger                                          | Message                  | Grade                       |
| ------------------------------------------------ | ------------------------ | --------------------------- |
| No `Authorization` header                        | Authentication required  | W (c015)                    |
| A token without the `Bearer ` prefix             | Authentication required  | W (c018)                    |
| A Basic header                                   | Authentication required  | W (c019)                    |
| `Bearer not-a-jwt`, or a forged signature        | Invalid token            | W (c016, c017, c1500)       |
| An expired token, or one superseded by a refresh | Token invalid or expired | W (c389, c400, c742, c1498) |

Routing precedes authentication: an unknown route without a token is 404 `not_found`, not 401 (W
c021). On a POST the 401 precedes the handler. `hold/create` with a superseded token that was never
used, and with `Bearer not-a-jwt`, answered 401; a lookup of each request's `externalId` with a
valid token then answered `transaction_not_found`, while the same body with a valid token created a
hold (W c1493–c1505). A superseded token that was used before its refresh is not rejected:
`hold/create` with one created a hold (W c1484, c1485).

## Gateway status

`GET {BASE_URL}/merchant/status/` returns HTTP 200, flat `{"status": "ok"}` (W c001, c022).

- It needs no authentication (W c022). A Bearer header is accepted and not validated: a token that
  `bankList/` rejected right after got 200 here (W c399, c400). It is a gateway liveness check,
  never a credential or account check.
- `POST` returns 405 `method_not_allowed`, `data` `null` (W c023).

## Bank list

`GET {BASE_URL}/merchant/bankList/` with a Bearer token returns HTTP 200 and a bare JSON array,
without the envelope (W c014):

```json
[
  { "id": 1, "name": "Hamkorbank", "official_name": null },
  { "id": 28, "name": "O‘zagroeksportbank", "official_name": null }
]
```

| Field           | Type             | Notes                                                                                                    | Grade    |
| --------------- | ---------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| `id`            | integer          | 37 entries, ids 1 to 38 without 21. Card objects carry the same id as the string `bankId` (W c027, c052) | W (c014) |
| `name`          | string           | Contains non-ASCII letters and backticks, e.g. `O‘zagroeksportbank`, ``O`zKDB bank``                     | W (c014) |
| `official_name` | string or `null` | `null` in every DEV entry                                                                                | W (c014) |

- Unknown query parameters are ignored (W c400, c402, c408). Failures are the
  [Bearer failures](#bearer-failures) (W c015–c019, c389, c400).
- The sandbox page bundle describes it as "banks + MFO codes" (S); no MFO field exists.

## Observed behavior

DEV live run 2026-11-12; no numbered capture.

- A refresh grant succeeded and authorized the following call; rotation was not re-checked.
- A password grant with a wrong consumer secret and an unknown username answered `401 invalid_grant`
  with the "Invalid consumer secret" message, so the consumer secret is checked before the user
  credentials.
- A header-less revoke answered HTTP 200, consistent with W c395, c407; the token was not used
  afterwards.

## Deviations from vendor docs

- The docs show onboarding token failures flat (`{"error": "invalid_or_expired"}`); live they are
  enveloped (W c365), and a short or missing token is `validation_error` (W c359, c360).
- The ru and uz quick references list `token_required` for onboarding without a token; en omits it,
  and live that case is `validation_error` (W c360).
- The docs say a revoked token can no longer be used; on DEV a revoked access token keeps working (W
  c396, c408, c925).
- The sandbox bundle's revoke tester sends a Bearer header and shows the success as
  `{"status": "revoked"}` (S); live success is `{"status": "success"}` (W c502).
- The docs use `GET /merchant/status/` as a Bearer example; it needs no token and validates none (W
  c022, c399).
- The changelog calls only token, revoke and onboarding flat; `status/` is flat too and `bankList/`
  is a bare array (W c001, c014).
- Credential literals use safe placeholders; the reusable password examples are omitted and the
  composition rules kept.
