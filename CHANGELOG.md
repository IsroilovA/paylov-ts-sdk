# Changelog

Consumer-visible changes, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.4] - 2026-11-23

### Changed (breaking)

- **Behavior:** `isPaylovOutcomeUnknown` now also returns `true` for `processing_error`,
  `unknown_error` and `error_at_pay` from a call that can charge, reserve, capture, release, refund
  or split funds (`payments.pay`, `payments.refund`, `payments.confirmPanPayment`, `holds.create`,
  `holds.capture`, `holds.release`, `splits.create`). Reconcile before acting again.
  `processing_error` from `payments.pay` and specific declines stay definitive. `PaylovApiError`
  gains `isUnsettled`, also in `toJSON()`: true for HTTP 500 and above and for those codes.
- `holds.create` returns `HoldCreated`: the transaction id plus `durationMinutes` and
  `clientCaptureDeadline`, a lower bound on expiry computed from the client clock before the request
  is sent. It is not proof of release.
- `PaylovWebhookReceiver` takes `{ credentials: [{ login, password }, ...] }` instead of
  `{ login, password }`, and every received event carries `credentialIndex`: `WebhookOutcome` is
  `ReceivedWebhookEvent | InvalidWebhook`. `createWebhookRequest(event, credentials)` takes one
  `PaylovWebhookCredentials` pair.
- `baseUrl` configuration errors name their context, e.g.
  `PaylovClient config: baseUrl must use https`.

### Added

- `transactions.iterate(params?, { signal })`: an async iterable over every paid transaction in a
  Tashkent date range. It stops at `total` or an empty page and throws `PaylovProtocolError` when
  two pages in a row bring no new row.
- `readHoldState` and `readRefundState`: pure decisions over `holds.get` and `transactions.get`
  reads, answering `unknown` whenever the read proves nothing. New types: `HoldCreated`,
  `HoldState`, `ReadHoldStateParams`, `RefundState`, `ReadRefundStateParams`,
  `IterateTransactionsParams`, `ReceivedWebhookEvent`, `PaylovWebhookCredentials`.
- `maxGetRetries` (0 to 5, default 2; POST and DELETE never retry) for `PaylovClient` and
  `PaylovOnboarding`, and `PaylovClient`'s `now`, the clock behind token expiry and hold deadlines.
- `createCheckoutUrl({ baseUrl })`: an https checkout origin other than `https://my.paylov.uz`.
- Webhook credential rotation: several credential pairs, all compared in constant time.
- `/testing`: `new PaylovFakeGateway({ simulate: true, now })` with `addCard`, simulating cards,
  payments, transactions and holds as observed on Paylov's test environment, and answering
  `fake_unsimulated` for a state it does not cover; other methods still need a script, and scripted
  answers take precedence. `fake.token` scripts token-endpoint failures (`invalid_grant` per grant,
  429 with `Retry-After`) in both modes. New types: `PaylovFakeGatewayOptions`,
  `PaylovFakeTokenEndpoint`, `PaylovFakeTokenFailure`, `PaylovFakeGrant`.

## [0.0.3] - 2026-11-19

### Changed

- Published from the repository's `release.yml` workflow, which its npm provenance now names. The
  package contents are unchanged.

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

[0.0.4]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.4
[0.0.3]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.3
[0.0.2]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.2
[0.0.1]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.1
