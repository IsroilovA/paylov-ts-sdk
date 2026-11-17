# Changelog

Consumer-visible changes, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Fiscal receipt items document `priceTiyin` as the unit price and `discountTiyin` as a per-unit
  discount: a line totals `(priceTiyin - discountTiyin) * count`. This is the SDK's reading; Paylov
  documents no formula.

## [0.0.1] - 2026-11-16

Initial release. Documented in [`docs/usage/`](docs/usage/INDEX.md).

### Added

- `PaylovClient` for the Paylov merchant gateway, with lazy OAuth2, GET-only retries, metadata-only
  logging and a `close()` that revokes the access token. Logger request events name the
  `PaylovHttpMethod`; response events carry a `PaylovErrorCode`.
- Errors classified by origin and discriminated by `kind`: `PaylovInputError`, always with its
  `PaylovInputRule`; `PaylovClientClosedError` (`sdk_client_closed`) for calls after `close()`;
  `PaylovApiError`; `PaylovProtocolError`; and `PaylovConnectionError`, whose `isSent: false`,
  message and `toJSON()` mark an abort that fired before anything was sent. `toJSON()` is safe to
  log, and `PaylovErrorDiagnostic.code` is a `PaylovErrorCode`.
- `isPaylovOutcomeUnknown` for recovery after ambiguous failures; it is false for a closed client
  and for an abort before sending.
- Integer tiyin money with `sumToTiyin` and `formatSum`.
- `paylov.gateway` for gateway status and issuing banks.
- `paylov.cards`: Card Bind links and sessions, PAN binding with `cardExpiry` and an OTP, card
  reads, deletion and phone checks. A card reports `isActive`, `processingStatus`
  (`CardProcessingStatus`) and `isSmsEnabled`.
- `paylov.payments`: saved-card payments, PAN payments with `cardExpiry` and an OTP, and full
  refunds. `account` is optional on `create` and `startPanPayment`.
- Optional OTP SMS settings, `sms` (`OtpSmsSettings`), on `cards.startPanBinding`,
  `payments.startPanPayment` and `payments.confirmPanPayment`, forwarded to Paylov unchanged.
- `paylov.transactions`: a reconciliation read, a settled-sales list and the RRN read.
  `TransactionStatus` is `created`, `held`, `paid`, `failed`, `refunded`, `transfer` or `pending`; a
  refunded sale reads `refunded`, and so can an expired hold Paylov released. A `Transaction`
  carries no `account`.
- `paylov.holds`: create, capture once, release and read. `HoldStatus` is `held`, `captured`,
  `released` or `created`; `held` names the same state in `TransactionStatus`, where a captured hold
  reads `paid`.
- `paylov.splits`, with an optional `resendOfd` on `create`, and `paylov.subMerchants`, whose
  `CreateSubMerchantParams` requires `tin` or `pinfl`, and `tin` with `organization`.
- `paylov.fiscalization`: register, read, attach and refund OFD receipts, and check activity types.
  Receipt items, fiscal and split alike, take an optional `discountTiyin`. `getReceipt` resolves
  `null` when a known transaction or an `externalId` has no receipt. `attachReceipt` takes
  `receiptUrl` and `issuedAtRaw`, and receipt summaries report `issuedAtRaw`.
  `FiscalReceiptRegistered` is `FiscalReceipt` without `isRefund`.
- `createCheckoutUrl` for the hosted checkout page.
- `PaylovWebhookReceiver` and `createWebhookResponse` for the five inbound callback kinds.
  `WebhookInput.body` takes JSON text, `Uint8Array`, `ArrayBuffer` or a parsed JSON value; anything
  else answers `malformed_body`.
- `PaylovOnboarding` for the one-time credential issue.
- The `@isroilov_an/paylov/testing` entry point: `PaylovFakeGateway`, which scripts every client and
  onboarding method through `PaylovFakeMethod`, records the params each request sent, and names the
  serving method in `PaylovFakeCall.method`, a union of method names or `null`. A request it cannot
  read back fails with `fake_unreadable_request` and is reported by `assertDone()`.
  `createWebhookRequest` builds authenticated webhook requests.

[0.0.1]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.1
