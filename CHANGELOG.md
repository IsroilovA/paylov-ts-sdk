# Changelog

Consumer-visible changes, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed (breaking)

- **Behavior:** no lookup resolves `null` for "not found" any more; a miss throws `PaylovApiError`.
  Catch the code instead of comparing with `null`; right after an ambiguous call the miss still does
  not prove the call did not run.
  - `holds.get` resolves `Hold` instead of `Hold | null` and throws Paylov's
    `transaction_not_found`.
  - `transactions.get` resolves `Transaction` instead of `Transaction | null`. Paylov answers an
    unknown id with an empty list, which the SDK throws as `transaction_not_found`, the code
    `holds.get` throws, with the answer's HTTP status (200); it is definitive, never unsettled.
  - `splits.get` resolves `Split` and throws Paylov's `split_not_found` for a transaction without a
    split.
  - `readHoldState` takes a non-null `hold`, and its optional `transaction` is no longer nullable;
    `readRefundState` takes a non-null `transaction`. `null` is rejected with `sdk_invalid_input`.
  - `/testing`: `holds.get`, `transactions.get` and `splits.get` no longer take `reply(null)`;
    script a miss with `fail('transaction_not_found')` or `fail('split_not_found')`. The simulated
    gateway answers an unknown hold or transaction with `transaction_not_found`.
- `splits.get` resolves `Split` instead of `readonly SplitShare[]`: `Split` holds the recipient
  `shares` and the split's fiscal `receipt` (`FiscalReceipt | null`), which Paylov sends as an extra
  entry of the status result that previously failed decoding with `sdk_malformed_response`.
- `SplitShare.createdAtRaw` (text) is replaced by `createdAt`, a `Date` decoded as Tashkent time,
  the zone Paylov's test environment uses. The `/testing` fake takes and encodes `Split`.
- `CreateSplitParams.resendOfd` is removed: resubmitting a split's receipt lines to the OFD is the
  new `splits.resendReceipt(ResendSplitReceiptParams)`, which takes the split's recipients with
  their items (`SplitReceiptRecipient`), splits nothing, moves no money, and resolves
  `SplitReceiptResent` (`transactionId`, `status`, `lastOfdError`). It is scripted as
  `fake.splits.resendReceipt`.
- **Behavior:** `processing_error` from `payments.pay` is now an unknown outcome like on the other
  money-moving methods: `isPaylovOutcomeUnknown` and `PaylovApiError.isUnsettled` return `true`.
  Read the transaction before paying again.
- **Behavior:** `holds.get` reports the record a declined `holds.create` leaves as `declined`
  instead of passing Paylov's `check` through. `readHoldState` takes an optional `transaction`, the
  `transactions.get` read of the hold, and answers `{ kind: 'declined' }` instead of `unknown` when
  that transaction reads `failed`: nothing is reserved and the `externalId` is used up, so a new
  attempt needs a new `externalId`. A `declined` hold without it stays `unknown`. `HoldStatus` and
  `HoldState` gain `declined`; an exhaustive switch over `HoldState` needs the new case.
- The `merchant.deposit` webhook is no longer supported: `PaylovWebhookReceiver` and
  `createWebhookRequest` handle only `transaction.cancel`. Removed: `MerchantDepositEvent`;
  `WebhookEvent` is `TransactionCancelEvent`, and a `merchant.deposit` body is
  `{ kind: 'invalid', reason: 'unknown_method' }`.
- Hosted checkout is no longer supported. Removed: `createCheckoutUrl`, `CreateCheckoutUrlParams`,
  `CheckoutAmount`, `CheckoutCurrency`, `createWebhookResponse`, `WebhookDecision`,
  `WebhookResponseStatus`, `WebhookResponseBody`, `WebhookCallbackId`, `TransactionCheckEvent`,
  `TransactionPerformEvent` and `Transaction.isCheckout`. A `transaction.check` or
  `transaction.perform` body is `{ kind: 'invalid', reason: 'unknown_method' }`.
- Hosted card binding (Card Bind) is no longer supported; bind cards with `cards.startPanBinding`
  and `cards.confirmPanBinding`. Removed: `cards.createBindLink`, `cards.getBindSession` (also from
  the `/testing` fake), `CreateBindLinkParams`, `CardBindLinkCreated`, `GetBindSessionParams`,
  `CardBindStatus`, `BoundCardBindSession`, `PendingCardBindSession`, `CardBindSession`,
  `CardBindEvent`, and `link_expired` and `link_already_used` from `PaylovKnownErrorCode`.
  `PaylovWebhookReceiver` and `createWebhookRequest` no longer handle the Card Bind webhook; a Card
  Bind body is `{ kind: 'invalid', reason: 'invalid_request' }`.
- `OtpSmsSettings` and the `sms` parameter of `cards.startPanBinding`, `payments.startPanPayment`
  and `payments.confirmPanPayment` are removed; the SDK no longer sends `sms`.
- Cash-sale fiscalization is removed: `fiscalization.registerReceipt` and `fiscalization.getReceipt`
  take a card payment's `transactionId` only, and no longer send `externalId` or `phoneNumber`.
  Removed: `RegisterCardFiscalReceiptParams` and `RegisterCashFiscalReceiptParams`;
  `RegisterFiscalReceiptParams` and `GetFiscalReceiptParams` are plain `transactionId` types.
  `getReceipt` no longer resolves `null` for Paylov's `ofd_check_not_found`.
- `fiscalization.attachReceipt` (Paylov's set-receipt) and `AttachFiscalReceiptParams` are removed,
  also from the `/testing` fake.
- `FiscalReceiptSummary.issuedAtRaw` (text) is replaced by `issuedAt`, a `Date` decoded as UTC, the
  zone Paylov's test environment uses: the payment time for a sale receipt, the refund time for a
  refund receipt. The `/testing` fake takes and encodes `issuedAt`.

### Changed

- `FiscalReceipt` and `FiscalReceiptRegistered` are now shared types; their shape is unchanged.
  `PaylovKnownErrorCode` gains `ofd_comitent_not_provided`, which `splits.create` answers for an
  item without `tin` or `pinfl`.
- Splits JSDoc and usage docs describe the observed contract: recipient ids are UUIDs; an unpaid
  transaction answers `receipt_not_available_for_split`; `resendReceipt` answers `split_not_found`
  without a split and `ofd_check_already_generated` once a receipt exists; `payments.refund` of a
  split transaction cancels every share. The README no longer claims splits to sub-merchants.
- Fiscalization JSDoc and usage docs describe the observed receipt lifecycle: `payments.refund`
  registers a fiscalized payment's refund receipt seconds to minutes later; `refundReceipt` answers
  `receipt_not_available_for_operation` before the refund and `ofd_check_already_generated` once a
  refund receipt exists; `getReceipt` without `isRefund` returns the refund receipt once one exists;
  `registerReceipt` can fail with `transaction_not_found`, and an `ofd_error` for a rejected item,
  such as a `packageCode` the tax classifier does not list for its `code`, registers nothing.
- `/testing`: the simulated `PaylovFakeGateway` answers `transactions.get` of a hold released by
  `holds.release`, before or after it expired: `refunded` with `isHold: true` and the release time
  as `cancelledAt`, as Paylov reports it.

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
