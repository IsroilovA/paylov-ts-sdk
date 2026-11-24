# Paylov API reference

How Paylov works, from the [vendor mirror](../vendor/paylov/), live assets and DEV responses. Each
feature page opens with its surface, then `## Flow` (actors, sequence, states, recovery), one
section per endpoint, `## Observed behavior` and `## Deviations from vendor docs`. Unresolved
behavior is marked `[OPEN Qn]` and tracked in [open-questions.md](open-questions.md). Change this
reference only through the
[sync-paylov-reference skill](../../.agents/skills/sync-paylov-reference/SKILL.md).

## Flows

The merchant server holds the credentials and calls the REST gateway with a Bearer token. The
customer (cardholder) enters card data and OTPs either on a Paylov page or through the merchant.
Paylov calls the merchant back for checkout and some events. Every flow ends in a transaction that
is read separately from the call that made it.

- [authentication.md](authentication.md): onboarding, OAuth2 token and refresh, revoke, Bearer
  failures, gateway status, bank list.
- [checkout.md](checkout.md): the hosted payment link (built locally, unsigned) and the GraphQL
  internal-checkout mutations behind the page; Paylov asks the merchant to check and perform the
  payment through [callbacks.md](callbacks.md).
- [cards.md](cards.md): binding a card to a merchant user, by a hosted Card Bind link or by PAN and
  OTP; card reads, delete, phone check. The resulting `cardId` pays [payments](payments.md) and
  [holds](holds.md).
- [payments.md](payments.md): saved-card create and pay, payment without registration (PAN and OTP,
  no binding), full refund by cancel.
- [holds.md](holds.md): reserve on a bound card, capture once (charge) or release (dismiss).
- [transactions.md](transactions.md): the transaction read by id (every state), the paid-only list,
  RRN. Reconciliation of every flow ends here; holds also have [hold status](holds.md#status).
- [splits.md](splits.md) and [sub-merchants.md](sub-merchants.md): allocating a paid transaction to
  recipients, creating child merchants.
- [fiscalization.md](fiscalization.md): OFD tax receipts for a transaction, and tax-service
  activity-type checks.
- [callbacks.md](callbacks.md): inbound `transaction.check`, `transaction.perform`,
  `transaction.cancel`, `merchant.deposit` and the Card Bind webhook.
- [errors.md](errors.md): response shapes, HTTP statuses, the code catalogue.

No request takes an idempotency key, and a replayed money-moving call answers a state code that does
not prove the earlier outcome ([payments](payments.md#common-rules)). Merchant permission gates
splits, sub-merchants, fiscalization and Card Bind (D); the DEV merchant has only Card Bind (W c082,
c271, c1452, c1453).

## Hosts

`{BASE_URL}` is the bare host; merchant REST paths start with `/merchant/`.

| Use                             | Host                                                                                                                                                                                                                                      | Grade                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Production REST gateway         | `https://gw2.paylov.uz`                                                                                                                                                                                                                   | D (one Card Bind curl example), L |
| DEV REST gateway                | `https://dev.gw.paylov.uz`; accepts only allowlisted source networks                                                                                                                                                                      | W (c001, c002)                    |
| DEV GraphQL (internal checkout) | `https://dev.app.paylov.uz/graphql/`, no authentication                                                                                                                                                                                   | W (c340)                          |
| Production GraphQL              | `https://app.paylov.uz/graphql/`, the endpoint the production checkout page (`index.d4f12633.js`) uses; only the session-storage value `__paylov_active_backend_env` = `dev` switches it to `https://my.paylov.uz/graphql/`. Never called | L                                 |
| Checkout links                  | `https://my.paylov.uz`, the only checkout host the docs name; its page runs against production GraphQL, and DEV checks report their `checkoutUrl` on it too. No DEV checkout page is known                                                | D, L, W (c792)                    |
| Card Bind page (`bindUrl`)      | `https://paylov.uz/card-bind/` on DEV, `https://my.paylov.uz/card-bind/` in the docs; it completes binds against the production gateway only ([hosted bind page](cards.md#hosted-bind-page))                                              | W (c082), L, D                    |

The docs describe no sandbox, test cards or credential separation; the sandbox page bundle carries
test cards with per-card OTPs, PINFLs and phones (L). DEV and production use separate credentials
and tokens, and each environment's source-IP allowlist is arranged with Paylov (M 2026-11-14). The
docs name the merchant/key allowlist only in error codes (D).

## Amount units by operation

100 tiyin = 1 SUM. Where a tiyin field exists it is exact; read it instead of the unit-currency
field: a check of 100049 tiyin reads `amount_in_tiyin` 100049 and `amount` 1000.49 (W c1160, c1164).

| Operation                       | Field                            | Wire unit                                                           | Grade                      |
| ------------------------------- | -------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| `receipts/create`               | `amount`                         | SUM, integer, ≥ 1                                                   | W (c086, c087, c096)       |
| `paymentWithoutRegistration/`   | `amount`                         | SUM, integer, ≥ 1                                                   | W (c166, c170, c177, c590) |
| `getTransactions`               | `amount` / `amount_in_tiyin`     | SUM float / tiyin integer                                           | W (c087, c346)             |
| Hold create                     | `amount`                         | SUM, integer, ≥ 10                                                  | W (c181, c187, c204)       |
| Hold charge                     | `amount`                         | SUM, integer, 10 ≤ amount ≤ held amount                             | W (c188, c189, c194, c346) |
| Hold status                     | `amount`                         | SUM, integer; the held amount, then the captured amount once `paid` | W (c184, c195)             |
| Card objects                    | `balance`                        | tiyin                                                               | W (c027, c052), D          |
| Split create and status         | `recipients[].amount` / `amount` | tiyin (en, ru example comment)                                      | D                          |
| OFD register and split items    | `price`                          | tiyin                                                               | D                          |
| OFD register and split items    | `discount`                       | tiyin (at most `price`, which is tiyin)                             | M 2026-11-15               |
| `internalCheckoutCreate`        | `amount`                         | SUM, or tiyin with `amountInTiyin: true`                            | W (c347, c352)             |
| Checkout link                   | `amount`                         | SUM, or minor units with `amount_in_tiyin=True`                     | D, L                       |
| `transaction.check` / `perform` | `amount` / `amount_tiyin`        | Whole currency units / minor units                                  | D                          |
| `transaction.cancel`            | `amount` / `amount_in_tiyin`     | Whole UZS / tiyin                                                   | D                          |
| `merchant.deposit`              | `amount_in_tiyin`                | tiyin                                                               | D                          |

## Timestamps by operation

Tashkent is UTC+05:00 all year; Uzbekistan has no daylight saving time.

| Field                                                        | Format and zone                         | Grade          |
| ------------------------------------------------------------ | --------------------------------------- | -------------- |
| `getTransactions` `date`, `cancel_time`; cancel `cancelTime` | `YYYY-MM-DD HH:MM:SS`, Tashkent         | W (c087, c113) |
| Hold charge `payedAt`; hold status `payedAt`, `cancelTime`   | `YYYY-MM-DD HH:MM:SS`, UTC              | W (c194, c199) |
| Bind link `expiresAt`                                        | ISO 8601 with microseconds and `+05:00` | W (c082)       |
| Callback `cancel_time`, `create_time`                        | Unix seconds                            | D              |
| Split status `createdAt`; transaction `ofd[].date_time`      | `YYYY-MM-DD HH:MM:SS`, zone unstated    | D              |
| OFD set-receipt `dateTime`                                   | `YYYYMMDDHHMMSS`                        | D              |

## Surface outside the SDK

Additional routes and their evidence limits. SDK scope decisions belong to
[architecture](../architecture.md#scope); their error codes are in
[errors.md](errors.md#codes-outside-the-sdk).

| Area                                                                                | Method and path                                                                                                                                                         | Evidence limit                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credit to card                                                                      | `POST /merchant/creditToCard/`                                                                                                                                          | No docs page and no success shape; the `amount` unit is unknown (W c237, c241)                                                                                                                           |
| WLCM fiscalization                                                                  | `POST /merchant/wlcm/fiscal/register/`, `POST /merchant/wlcm/fiscalization/refund/`                                                                                     | No docs page; the schema is only partly known and no success shape exists (W c286–c293)                                                                                                                  |
| Didox three-party contracts                                                         | `POST /merchant/didox/three-party-contract/`, `GET .../{id}/status/`                                                                                                    | The [docs page](../vendor/paylov/didox.md) is access-restricted and no success shape exists (W c310–c323)                                                                                                |
| Saved-card `payment/` flow                                                          | `POST /merchant/payment/`                                                                                                                                               | Tester-only receipts-like flow with an `is_hold` flag; zero amount is `invalid_amount` (W c120–c126, c333–c339)                                                                                          |
| P2P transfers and QR payments                                                       | `p2p/…`, `qr/…`                                                                                                                                                         | The [p2p](../vendor/paylov/subscribe/p2p-transfer.md) and [qr](../vendor/paylov/qr-payments.md) pages are access-restricted and every candidate route is `404 not_found` (W c238, c306–c309, c312, c313) |
| Bound cards                                                                         | `GET /merchant/boundCards/`                                                                                                                                             | Tester route, `404 not_found` (W c077)                                                                                                                                                                   |
| Internal checkout (GraphQL)                                                         | `internalCheckoutCreate`, `internalCheckoutPayment`, `internalCheckoutConfirm`                                                                                          | No docs page; known from the checkout and sandbox page bundles (L, S) and DEV captures ([checkout](checkout.md#internal-checkout-graphql))                                                               |
| GraphQL account sign-in                                                             | `checkPhone`, `register`, `activate`, `login`, `confirm`, `refreshToken`, `me`                                                                                          | End-user Paylov app accounts with phone, password and SMS OTP, not the merchant; no merchant operation needs their token (S)                                                                             |
| A2C payouts, card history and logs, PINFL check, official profile, service payments | `/merchant/a2c/…`, `getCardHistory/`, `getCardHistoryLogs/`, `userCard/checkPinflMatch/`, `userCard/createOfficialProfile/`, `servicePayment/…`, `sub/servicePayment/…` | Documented in the [vendor mirror](../vendor/paylov/)                                                                                                                                                     |

## Evidence

- **D:** the developer docs, as mirrored. Unless a page says otherwise, the en, ru and uz versions
  agree.
- **L:** live static assets, named where cited: the checkout page bundle on `my.paylov.uz` and the
  sandbox page bundle on `sandbox.paylov.uz`.
- **S:** request forms and examples in the sandbox page bundle. They often contradict D and W with
  mock fields and units, so they prove at most that a route exists.
- **W:** a DEV gateway response, cited as `W (cNNN)` in the maintainer’s numbered live-capture set
  of redacted request/response pairs, kept in the git-ignored `captures/` and never committed. W is
  DEV evidence only; production may differ.
- **Live run:** a DEV live-suite observation without a numbered capture, cited as
  `live run YYYY-MM-DD`. It supports logged codes, HTTP statuses, counts, booleans and clock skew,
  never a body shape.
- **M:** a maintainer decision, cited as `M YYYY-MM-DD`: what the SDK assumes where Paylov evidence
  is silent and the SDK must act on an answer. It is not Paylov evidence. Usage docs and JSDoc word
  an M fact as the SDK's assumption, never as Paylov behavior. An M fact may settle an open question
  only in that case; any D, W or Paylov answer that contradicts it replaces it.

Every fact carries one of these grades, cites the vendor mirror, or cites a recorded Paylov answer.
In prose a grade follows the fact in parentheses, `(W c086, c087)`; tables carry a Grade column, and
a page-wide grade is stated once under its heading. Where W contradicts D, W is the contract and the
owning page lists the contradiction under `## Deviations from vendor docs`. New live observations
follow the skill's live-observation procedure.
