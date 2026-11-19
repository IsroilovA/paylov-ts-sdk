# Changelog

Consumer-visible changes, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-11-19

### Changed

- The README links only to files in the package or to the GitHub repository, so every link works
  from npm and from an installed copy.

## [0.0.1] - 2026-11-17

Initial release. Documented in [`docs/usage/`](docs/usage/INDEX.md).

### Added

- `PaylovClient` for the Paylov merchant gateway, with lazy OAuth2, GET-only retries, metadata-only
  logging and a `close()` that revokes the access token.
- Typed errors discriminated by `kind`: `PaylovInputError`, `PaylovClientClosedError`,
  `PaylovApiError`, `PaylovProtocolError` and `PaylovConnectionError`, each with a log-safe
  `toJSON()`. `isPaylovOutcomeUnknown` guides recovery after ambiguous failures.
- Integer tiyin money with `sumToTiyin` and `formatSum`.
- `paylov.gateway`: gateway status and issuing banks.
- `paylov.cards`: Card Bind links and sessions, card number binding with an OTP, card reads,
  deletion and phone checks.
- `paylov.payments`: saved-card payments, card number payments with an OTP, and full refunds.
- `paylov.transactions`: reconciliation reads, the settled-sales list and the RRN read.
- `paylov.holds`: create, capture once, release and read.
- `paylov.splits` and `paylov.subMerchants`.
- `paylov.fiscalization`: register, read, attach and refund OFD receipts, and check activity types.
  Receipt item lines total `(priceTiyin - discountTiyin) * count`; this is the SDK's reading, as
  Paylov documents no formula.
- `createCheckoutUrl` for the hosted checkout page.
- `PaylovWebhookReceiver` and `createWebhookResponse` for the five inbound callback kinds.
- `PaylovOnboarding` for the one-time credential issue.
- The `@isroilov_an/paylov/testing` entry point: `PaylovFakeGateway`, an in-memory gateway that
  scripts every client and onboarding method and records each request, and `createWebhookRequest`
  for authenticated webhook requests.

[0.0.2]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.2
[0.0.1]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.1
