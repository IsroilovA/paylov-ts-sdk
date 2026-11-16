# Paylov API reference

Paylov wire contracts from the [vendor mirror](../vendor/paylov/), live assets and DEV responses.
Each page lists its sources and records every correction in `## Deviations from vendor docs`.
Unresolved behavior is marked `[OPEN Qn]` and tracked in [open-questions.md](open-questions.md).
Change this reference only through the
[sync-paylov-reference skill](../../.agents/skills/sync-paylov-reference/SKILL.md).

## Evidence

- **D:** the developer docs, as mirrored. Unless a page says otherwise, the en, ru and uz versions
  agree.
- **L:** live static assets, named where cited: the checkout page bundle on `my.paylov.uz` and the
  sandbox page bundle on `sandbox.paylov.uz`.
- **S:** request forms and examples in the sandbox page bundle. They often contradict D and W with
  mock fields and units, so they prove at most that a route exists.
- **W:** a DEV gateway response, cited as `W (cNNN)` in the maintainer’s numbered live-capture set
  of redacted request/response pairs kept outside the repository. W is DEV evidence only; production
  may differ.
- **Live run:** a DEV live-suite observation without a numbered capture, cited as
  `live run YYYY-MM-DD`. It supports logged codes, HTTP statuses, counts, booleans and clock skew,
  never a body shape.
- **M:** a maintainer decision, cited as `M YYYY-MM-DD`: what the SDK assumes where Paylov evidence
  is silent and the SDK must act on an answer. It is not Paylov evidence. Usage docs and JSDoc word
  an M fact as the SDK's assumption, never as Paylov behavior, and any D, W or Paylov answer that
  contradicts it replaces it.

Every fact carries one of these grades, cites the vendor mirror, or cites a recorded Paylov answer.
Where W contradicts D, W is the contract and the owning page lists the contradiction under
`## Deviations from vendor docs`. New live observations follow the skill's live-observation
procedure.

## Hosts

`{BASE_URL}` is the bare host. Merchant REST paths start with `/merchant/`. Authentication rules are
in [authentication.md](authentication.md).

| Use                             | Host                                                                                                                                                                                                                                                                       | Grade                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Production REST gateway         | `https://gw2.paylov.uz`                                                                                                                                                                                                                                                    | D (one Card Bind curl example), L |
| DEV REST gateway                | `https://dev.gw.paylov.uz`; accepts only allowlisted source networks                                                                                                                                                                                                       | W (c001, c002)                    |
| DEV GraphQL (internal checkout) | `https://dev.app.paylov.uz/graphql/`, no authentication                                                                                                                                                                                                                    | W (c340)                          |
| Production GraphQL              | `https://app.paylov.uz/graphql/`, the endpoint the production checkout page (`index.d4f12633.js`) is configured with; only the session-storage value `__paylov_active_backend_env` = `dev` switches the page to `https://my.paylov.uz/graphql/`. No request was sent to it | L                                 |
| Checkout links                  | `https://my.paylov.uz`, the only checkout host the docs name; its page runs against the production GraphQL endpoint above, and DEV checks report their `checkoutUrl` on this host too. No DEV checkout page is known                                                       | D, L, W (c792)                    |
| Card Bind page (`bindUrl`)      | DEV links point at `https://paylov.uz/card-bind/`; the docs show `https://my.paylov.uz/card-bind/`. That page completes binds against the production gateway only ([hosted page](cards.md#hosted-bind-page)).                                                              | W (c082), L, D                    |

The docs describe no sandbox, test cards or credential separation. The sandbox page bundle carries
test cards with per-card OTPs, PINFLs and phones (L).

- DEV and production use separate credentials and tokens. Each environment's source-IP allowlist is
  arranged with Paylov (both M 2026-11-14). The docs name the merchant/key allowlist only in error
  codes (D).

## Amount units by operation

The wire unit differs per operation; 100 tiyin = 1 SUM. Where a tiyin field exists, it is the exact
value: a check of 100049 tiyin reads `amount_in_tiyin` 100049 and `amount` 1000.49 (W c1160, c1164);
read it instead of the unit-currency field.

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

## Pages

| Page                                   | Contents                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [authentication.md](authentication.md) | Onboarding, OAuth2 token and refresh, revoke, gateway status, bank list                                                |
| [cards.md](cards.md)                   | Card Bind link and session; PAN binding and confirm; get, list, delete; phone check                                    |
| [payments.md](payments.md)             | Saved-card payment create and pay; payment without registration and its confirm; cancel (full refund)                  |
| [transactions.md](transactions.md)     | `getTransactions` by id and as a list; RRN lookup                                                                      |
| [holds.md](holds.md)                   | Hold create, charge, dismiss, status                                                                                   |
| [splits.md](splits.md)                 | Split payment create and status                                                                                        |
| [sub-merchants.md](sub-merchants.md)   | Sub-merchant create                                                                                                    |
| [fiscalization.md](fiscalization.md)   | OFD receipts: register, status, set-receipt, refund; activity types                                                    |
| [checkout.md](checkout.md)             | Hosted checkout link, its encoding rules, merchant setup; GraphQL internal checkout                                    |
| [callbacks.md](callbacks.md)           | Inbound `transaction.check`, `transaction.perform`, `transaction.cancel`, `merchant.deposit` and the Card Bind webhook |
| [errors.md](errors.md)                 | Response shapes, HTTP statuses, code catalogue                                                                         |
| [open-questions.md](open-questions.md) | Unresolved Paylov behavior                                                                                             |

## Surface outside the SDK

Additional routes and their evidence limits. SDK scope decisions belong to
[architecture](../architecture.md#scope).

| Area                                                                                | Method and path                                                                                                                                                         | Evidence limit                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credit to card                                                                      | `POST /merchant/creditToCard/`                                                                                                                                          | No docs page and no success shape; the `amount` unit is unknown (W c237, c241)                                                                                                                           |
| WLCM fiscalization                                                                  | `POST /merchant/wlcm/fiscal/register/`, `POST /merchant/wlcm/fiscalization/refund/`                                                                                     | No docs page; the schema is only partly known and no success shape exists (W c286–c293)                                                                                                                  |
| Didox three-party contracts                                                         | `POST /merchant/didox/three-party-contract/`, `GET .../{id}/status/`                                                                                                    | The [docs page](../vendor/paylov/didox.md) is access-restricted and no success shape exists (W c310–c323)                                                                                                |
| Saved-card `payment/` flow                                                          | `POST /merchant/payment/`                                                                                                                                               | Tester-only receipts-like flow with an `is_hold` flag; zero amount is `invalid_amount` (W c335) (W c120–c126, c333–c339)                                                                                 |
| P2P transfers and QR payments                                                       | `p2p/…`, `qr/…`                                                                                                                                                         | The [p2p](../vendor/paylov/subscribe/p2p-transfer.md) and [qr](../vendor/paylov/qr-payments.md) pages are access-restricted and every candidate route is `404 not_found` (W c238, c306–c309, c312, c313) |
| Bound cards                                                                         | `GET /merchant/boundCards/`                                                                                                                                             | Tester route, `404 not_found` (W c077)                                                                                                                                                                   |
| Internal checkout (GraphQL)                                                         | `internalCheckoutCreate`, `internalCheckoutPayment`, `internalCheckoutConfirm`                                                                                          | No docs page; known from the checkout and sandbox page bundles (L, S) and DEV captures ([checkout](checkout.md#internal-checkout-graphql))                                                               |
| GraphQL account sign-in                                                             | `checkPhone`, `register`, `login`, `refreshToken` and related mutations                                                                                                 | End-user authentication with phone, password and SMS OTP (S)                                                                                                                                             |
| A2C payouts, card history and logs, PINFL check, official profile, service payments | `/merchant/a2c/…`, `getCardHistory/`, `getCardHistoryLogs/`, `userCard/checkPinflMatch/`, `userCard/createOfficialProfile/`, `servicePayment/…`, `sub/servicePayment/…` | Documented in the [vendor mirror](../vendor/paylov/)                                                                                                                                                     |

Error codes specific to these areas are listed in [errors.md](errors.md#codes-outside-the-sdk).
