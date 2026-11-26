# Changelog

Consumer-visible changes, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `readRefundState` takes an optional `isCaptured`: `true` asserts that the caller captured the hold
  with `holds.capture`, so a hold reading `refunded` with its refund time is `refunded` instead of
  `unknown`. Without it, behavior is unchanged.

### Changed

- **Behavior:** `splits.resendReceipt` accepts recipients without `items`, as Paylov's split example
  sends; at least one recipient must carry items, else `sdk_invalid_input` before sending. Each item
  still needs exactly one of `tin` or `pinfl`.
- `payments.refund` JSDoc and the payments, holds, transactions and errors usage guides describe
  captured holds as refundable through the API, per Paylov, and settle their refund with
  `readRefundState({ transaction, isCaptured: true })` instead of the business panel.
- The splits usage guide states that Paylov allows splitting a captured hold.
- `SplitRecipient.items` JSDoc and the splits usage guide state that a split has one receipt for the
  whole transaction: the items of all recipients must total the transaction amount, and one
  recipient may carry every line. Items totalling only their share were never registered in Paylov's
  test environment.

### Changed (breaking)

- `SplitReceiptRecipient` is removed: `ResendSplitReceiptParams.recipients` is
  `readonly SplitRecipient[]`.

## [0.0.6] - 2026-11-26

### Added

- `/testing`: `startGatewaySimulator(options)` serves the gateway simulation over HTTP, so several
  processes reach one simulated gateway through `baseUrl`. It persists its state to `stateFile` or a
  `PaylovSimulatorStore` after every change, never storing a full card number or an OTP, serves
  HTTPS with a supplied `tls` certificate or plain HTTP behind a TLS-terminating proxy, takes a
  controllable `now`, and reports every unsimulated request through `onProblem`. The SDK's
  `https`-only `baseUrl` rule is unchanged.
- `/testing`: the simulation binds cards by PAN. `fake.addPanCard(card)` (or the simulator's
  `panCards`) makes a card known; `cards.startPanBinding` and `cards.confirmPanBinding` bind it with
  `PAYLOV_FAKE_OTP` or the card's `otp`, answering the OTP, expiry, phone and PINFL refusals
  Paylov's test environment shows.
- `/testing`: the simulation registers fiscal receipts: `fiscalization.registerReceipt`,
  `getReceipt` and `refundReceipt` for paid payments and captured holds (for the captured amount;
  items for the held amount answer `invalid_amount`), with `ofd_check_already_generated` on a
  repeat, the receipts in `transactions.get`, and the refund receipt a `payments.refund` registers
  `refundReceiptDelaySeconds` later.

### Changed

- `cards.delete` JSDoc and the holds usage guide state that deleting a card does not release its
  holds: Paylov's test environment still captured and released holds created before the delete.
- `fiscalization.registerReceipt` JSDoc and the fiscalization usage guide state that a captured
  hold's items total its captured amount; items for the held amount fail with `invalid_amount`.
- **Behavior:** `/testing`: the simulated gateway captures in full and releases an open hold after
  its card was deleted, as Paylov's test environment does, instead of answering `fake_unsimulated`.
  A partial capture after the delete, and a capture or release of an expired hold after it, stay
  unsimulated.

## [0.0.5] - 2026-11-26

### Changed (breaking)

- **Behavior:** no lookup resolves `null` for "not found" any more; a miss throws `PaylovApiError`.
  Right after an ambiguous call the miss still does not prove the call did not run.
  - `holds.get` resolves `Hold` instead of `Hold | null` and throws Paylov's
    `transaction_not_found`.
  - `transactions.get` resolves `Transaction` instead of `Transaction | null`. Paylov answers an
    unknown id with an empty list, which the SDK throws as `transaction_not_found`, the code
    `holds.get` throws, with the answer's HTTP status (200); it is definitive, never an unknown
    outcome.
  - `splits.get` resolves `Split` and throws Paylov's `split_not_found` for a transaction without a
    split.
  - `readHoldState` takes a non-null `hold`; `readRefundState` takes a non-null `transaction`.
    `null` is rejected with `sdk_invalid_input`; a missing or only inherited one with
    `rule: 'required'` instead of `'type'`, like every other method.
  - `/testing`: `holds.get`, `transactions.get` and `splits.get` no longer take `reply(null)`. The
    simulated gateway answers an unknown hold or transaction with `transaction_not_found`.
- `splits.get` resolves `Split` instead of `readonly SplitShare[]`: `Split` holds the recipient
  `shares` and the split's fiscal `receipt` (`FiscalReceipt | null`), which Paylov sends as an extra
  entry of the status result that previously failed decoding with `sdk_malformed_response`.
- `SplitShare.createdAtRaw` (text) is replaced by `createdAt`, a `Date` decoded as Tashkent time,
  the zone Paylov's test environment uses. The `/testing` fake takes and encodes `Split`.
- `CreateSplitParams.resendOfd` is removed: resubmitting a split's receipt lines to the OFD is the
  new `splits.resendReceipt(ResendSplitReceiptParams)`, which takes the split's recipients with
  their items (`SplitReceiptRecipient`), splits nothing, moves no money, and resolves
  `SplitReceiptResent` (`transactionId`, `status`); the OFD diagnostic text Paylov also returns is
  not exposed. It is scripted as `fake.splits.resendReceipt`.
- **Behavior:** an unknown outcome has one carrier, `isOutcomeUnknown` on `PaylovApiError`,
  `PaylovProtocolError` and `PaylovConnectionError` (also in `toJSON()`), which
  `isPaylovOutcomeUnknown` returns. `PaylovApiError.isUnsettled` is removed. The three constructors
  take an optional `isOutcomeUnknown`, default `false`; a constructed HTTP 500 error no longer
  counts as unknown by its status. What a failure leaves unknown depends on what the method changes:
  - A read (every `get`, `list` and `iterate`, `transactions.getRrn`, the `gateway` methods,
    `fiscalization.getReceipt`, `fiscalization.checkActivityType`, `cards.checkPhone`,
    `PaylovOnboarding.checkToken`) never leaves it unknown, also after HTTP 500, a malformed body or
    a connection failure; the stalled-page error of `transactions.iterate` included.
  - Any other method leaves it unknown after HTTP 500 and above, a protocol error, or a connection
    failure once its request was sent, as before.
  - The generic codes `processing_error`, `unknown_error` and `error_at_pay` count for every method
    that moves money, `processing_error` from `payments.pay` included, and for no other method;
    `splits.resendReceipt` no longer counts them.
  - A failure before the method's own request was sent is known, also when the token grant
    disconnected, answered a malformed 200 or a 5xx (the error still names the token endpoint), and
    when an abort ends the call after a rejected token and before its replay.
- `PaylovKnownErrorCode` drops `insufficient_deposit`, `already_confirmed` and
  `ofd_too_many_requests_for_this_receipt`, which only unsupported flows answer (payouts, saved-card
  two-step confirmation, receipt attachment). A gateway that sends one still yields a
  `PaylovApiError` with that code.
- **Behavior:** `holds.get` reports the record a declined `holds.create` leaves as `declined`
  instead of passing Paylov's `check` through. `ReadHoldStateParams` gains an optional
  `transaction`, the new `HoldTransactionRead` (the fields of the hold's `transactions.get` read
  that settle a decline; never `null`), and `readHoldState` answers `{ kind: 'declined' }` instead
  of `unknown` when that transaction reads `failed`: nothing is reserved and the `externalId` is
  used up. A `declined` hold without it stays `unknown`. `HoldStatus` and `HoldState` gain
  `declined`.
- The `merchant.deposit` webhook is no longer supported: `PaylovWebhookReceiver` and
  `createWebhookRequest` handle only `transaction.cancel`. Removed: `MerchantDepositEvent`;
  `WebhookEvent` is `TransactionCancelEvent`, and a `merchant.deposit` body is
  `{ kind: 'invalid', reason: 'unknown_method' }`.
- Hosted checkout is no longer supported. Removed: `createCheckoutUrl`, `CreateCheckoutUrlParams`,
  `CheckoutAmount`, `CheckoutCurrency`, `createWebhookResponse`, `WebhookDecision`,
  `WebhookResponseStatus`, `WebhookResponseBody`, `WebhookCallbackId`, `TransactionCheckEvent`,
  `TransactionPerformEvent` and `Transaction.isCheckout`. A `transaction.check` or
  `transaction.perform` body is `{ kind: 'invalid', reason: 'unknown_method' }`.
- Hosted card binding (Card Bind) is no longer supported; `cards.startPanBinding` and
  `cards.confirmPanBinding` remain. Removed: `cards.createBindLink`, `cards.getBindSession` (also
  from the `/testing` fake), `CreateBindLinkParams`, `CardBindLinkCreated`, `GetBindSessionParams`,
  `CardBindStatus`, `BoundCardBindSession`, `PendingCardBindSession`, `CardBindSession`,
  `CardBindEvent`, and `link_expired` and `link_already_used` from `PaylovKnownErrorCode`.
  `PaylovWebhookReceiver` and `createWebhookRequest` no longer handle the Card Bind webhook; a Card
  Bind body is `{ kind: 'invalid', reason: 'invalid_request' }`.
- `OtpSmsSettings` and the `sms` parameter of `cards.startPanBinding`, `payments.startPanPayment`
  and `payments.confirmPanPayment` are removed; the SDK no longer sends `sms`.
- Cash-sale fiscalization is removed: `fiscalization.registerReceipt` and `fiscalization.getReceipt`
  take a card payment's `transactionId` only, and no longer send `externalId` or `phoneNumber`.
  Removed: `RegisterCardFiscalReceiptParams` and `RegisterCashFiscalReceiptParams`;
  `RegisterFiscalReceiptParams` and `GetFiscalReceiptParams` are plain `transactionId` types. The
  `ofd_check_not_found` answer, which concerned only the removed `externalId` lookup, no longer
  resolves `null`: `getReceipt` throws `transaction_not_found` for an unknown transaction and
  resolves `null` for a known payment whose receipt is not registered yet.
- `fiscalization.attachReceipt` (Paylov's set-receipt) and `AttachFiscalReceiptParams` are removed,
  also from the `/testing` fake.
- `FiscalReceiptSummary.issuedAtRaw` (text) is replaced by `issuedAt`, a `Date` decoded as UTC, the
  zone Paylov's test environment uses: the payment time for a sale receipt, the refund time for a
  refund receipt. The `/testing` fake takes and encodes `issuedAt`.
- **Behavior:** a gateway error counts only in Paylov's documented envelope, with `result: null`. An
  `error` beside a non-null or absent `result` is a `PaylovProtocolError` (`sdk_unexpected_status`,
  or `sdk_malformed_response` with a 2xx), whose outcome is unknown for a method that writes; a 401
  `permission_denied` in such a body is no longer replayed after a new token.
- **Behavior:** `account` (`payments.create`, `payments.startPanPayment`, `holds.create`) is copied
  value by value instead of serialized, so it is sent exactly as validated. `NaN`, `Infinity`, a
  `Date` or other class instance, a function, a symbol and an `undefined` array entry fail with
  `sdk_invalid_input` instead of being converted (`NaN` to `null`, a `Date` to text) or dropped;
  `undefined` properties are still left out. An exception thrown by a getter or proxy inside
  `account` propagates unchanged instead of becoming `sdk_invalid_input`. Arrays are copied by
  index, as JSON does, never through a custom iterator, and a plain object from another realm (such
  as a `node:vm` context) is accepted.
- **Behavior:** a token-endpoint HTTP 429 with any code, `invalid_grant` included, starts the
  cool-down, for its delta-seconds `Retry-After` delay from 1 to 3600 or else 60 s: it no longer
  locks the client after a password grant, and no longer makes a refresh fall back to the password
  grant.
- **Behavior:** only `invalid_grant` at HTTP 401 is a credential verdict: at any other status it
  neither locks the client nor makes a refresh fall back to the password grant. A rejected grant
  keeps the newest access token for `close()` to revoke, also when the client closes during the
  rejected refresh.
- **Behavior:** a gateway error envelope needs a string `error.message` besides `result: null` and a
  code; one without is `PaylovProtocolError` (`sdk_unexpected_status`, `sdk_malformed_response` at
  2xx) with an unknown outcome for writes, and a 401 `permission_denied` without one is never
  replayed.
- **Behavior:** a token grant whose `token_type` is not `Bearer` fails with
  `sdk_malformed_response`.
- **Behavior:** `baseUrl` is checked for a path as given, so `https://host/merchant/..` and
  `https://host/.` are rejected instead of normalized to the origin.
- **Behavior:** a hold or transaction `status` that Paylov sends spelled as one of the SDK's words
  without being its wire spelling, such as `held` or `paid`, fails with `sdk_malformed_response`
  instead of reading as that status.
- **Behavior:** `readHoldState` and `readRefundState` read a settlement time that is an invalid
  `Date` as `unknown`.
- **Behavior:** `readHoldState` and `readRefundState` reject an array as `hold` or `transaction`
  with `sdk_invalid_input`. `readHoldState` reads a `captured` hold whose `amountTiyin` is not a
  valid tiyin amount as `unknown`. `readRefundState` reports a refunded sale only when `isHold` is
  literally `false`; any other `isHold` reads as `unknown`.
- **Behavior:** `fiscalization.checkActivityType` with `high_income` confirms only when the answer's
  `data.status` is `true`; `success: true` alone no longer does.
- **Behavior:** `transactions.iterate` yields a transaction once also when one page lists it twice.
- `/testing`: a `fiscalization.checkActivityType` reply with `isConfirmed: true` and no activity
  names is sent as the high-income answer object, so it reads back confirmed for every activity
  type.
- `PaylovProtocolError` gains `retryAfterSeconds` (also in `toJSON()`). Every HTTP 429 reads its
  `Retry-After` header, as delta-seconds from 1 to 3600, whatever the body holds, so a 429 with an
  unreadable or non-JSON body, or with another code than `rate_limit_exceeded`, reports the delay,
  and the token cool-down lasts that long instead of 60 s. On a 429 the header takes precedence over
  a delay in the body, such as a `card_is_blocked` block's rest.
- **Behavior:** a logger `onResponse` event is emitted after the endpoint's decoder has read the
  response: a response that breaks the endpoint's contract reports `sdk_malformed_response` or
  `sdk_unexpected_status` as `errorCode`, a 2xx included, also when it is JSON without the fields
  the method decodes. A revocation in `close()` answered at 2xx with anything but
  `{"status": "success"}` reports `sdk_malformed_response`; an enveloped gateway failure reports its
  API code, and a non-2xx with an unusable body `sdk_unexpected_status`. `close()` still resolves.
- **Behavior:** a failed token grant's error reaches each caller as its own copy, `fields` included:
  concurrent callers, and later calls rethrowing the password latch or the cool-down, no longer
  share one error object.
- **Behavior:** `readHoldState` and `readRefundState` read each parameter once, as an own property,
  and decide from the value read: an inherited `transaction` no longer settles a `declined` hold,
  and a getter answering differently on a second read no longer throws a native `TypeError`.
- `TransactionLookup` is removed from the package root; `GetHoldParams` is the same
  one-of-`transactionId`-or-`externalId` union.
- **Behavior:** `PaylovWebhookReceiver` decodes `transaction.cancel` only as the documented
  notification: a `transaction.cancel` body with a JSON-RPC `id` is
  `{ kind: 'invalid', reason: 'invalid_request' }`, and one whose `params.status` is not `cancelled`
  is `invalid_params`. A header record with more than one key matching `authorization`
  case-insensitively is `unauthorized` instead of authenticating with the first key.
- `/testing`: `PaylovFakeGateway.calls` and `PaylovFakeCall` are removed. Each method's `requests`,
  `fake.token.requests` and logger events record what was sent. `assertDone()` and the fake's own
  failures name an unscripted or unreadable request by its route template, never by its path values,
  and an unserved answer or an unsimulated state by its method, such as `holds.get`.
- `/testing`: a simulation or reply encoder that throws while answering a request is reported as
  `fake_unsimulated` instead of `fake_unreadable_request`; `fake_unreadable_request` is only for a
  request the fake cannot read back into its method's params.
- `/testing`: `fake.transactions.get.fail('transaction_not_found')` and the simulation answer an
  unknown transaction as Paylov does, with an empty list at HTTP 200, so the error has `httpStatus`
  200 and the logger event no `errorCode`. That failure takes no `httpStatus`, `fields` or
  `retryAfterSeconds`; passing one throws `TypeError`.
- `/testing`: `fail(code, { httpStatus: 429, retryAfterSeconds })`, `fake.token.fail` included,
  scripts a 429 with any code and that `Retry-After` delay instead of throwing `TypeError`.
- `/testing`: a card's reported `balanceTiyin` no longer approves simulated pays and holds.
  `addCard(card, { spendableTiyin })` takes the new `PaylovFakeCardOptions`, whose `spendableTiyin`
  is what pays and holds may take from the card in total; without it every pay and hold on the card
  answers `fake_unsimulated`. `addCard` throws `TypeError` for an invalid `spendableTiyin` and for
  the id of a card the simulation deleted.
- `/testing`: simulated refunds follow the new `PaylovFakeGatewayOptions.refundWindowMinutes` (needs
  `simulate: true`): a refund that long or longer after the payment answers
  `transaction_not_available_for_cancel` and the payment stays paid; without the option every refund
  of a paid payment answers `fake_unsimulated`. The Tashkent-day rule is removed.
- `/testing`: the simulation answers `fake_unsimulated` where Paylov's test environment showed no
  answer, among them a payment above 10 000 000 000 SUM, a hold above 1 000 000 000 SUM, a pay or
  hold that fits only once a refund, the uncaptured rest of a partial capture, or a hold released
  after it expired returns to the card, a `cards.get` or `cards.list` of a card it charged or held,
  a `transactions.list` with two rows paid in the same second, a transaction id in another UUID
  spelling, and a capture of a hold dismissed after it expired, also when the clock has sub-second
  precision. It answers a payment of zero with `field_not_valid` on `amount`, and a
  `transactions.get`, `payments.pay` or `payments.refund` of an id that is not a UUID with HTTP 400
  `validation_error` on `transactionId`, where `transactions.get` read it as
  `transaction_not_found`. A dismiss before expiry makes the held funds available to the card again.
- `/testing`: `createWebhookRequest` sends the documented `Content-Type: application/json` header
  and `params.amount` in whole SUM, and throws `TypeError` for an event the receiver would not
  decode, such as a `transactionId` that is not a UUID.
- `/testing`: `fake.subMerchants.create.reply` answers HTTP 201, as Paylov documents.
  `fake.gateway.listBanks.reply` throws `TypeError` for a `bankId` that is not a non-negative
  integer in plain decimal digits, instead of sending a rewritten or undecodable id. The fake reads
  an `onboarding.complete` request without a password, and a `subMerchants.create` request whose
  `organization` and `create_new_organization: true` do not come together, as
  `fake_unreadable_request`.

### Changed

- `transactions.list` and `transactions.iterate` are documented as returning rows in the gateway's
  order: roughly newest payment first, but not strictly. Sort the rows where order matters.
- Recovery guidance in JSDoc and usage docs: replay an ambiguous `holds.create` with the same stored
  `externalId`, a new one only after a confirmed decline; a `split_not_found` right after an
  ambiguous `splits.create` needs another read; `sub_merchant_already_created` after an ambiguous
  `subMerchants.create` leaves the result unresolved until Paylov confirms the child and its id;
  settle an ambiguous `payments.refund` with `readRefundState`, which reads a captured hold still
  `paid` as `not_refunded` and any hold reading `refunded` as `unknown`.
- `PaylovKnownErrorCode` gains `ofd_comitent_not_provided`, Paylov's answer to a split item without
  `tin` or `pinfl`. The SDK rejects such an item before sending, in `splits.create` and
  `splits.resendReceipt`, with `sdk_invalid_input` (`rule: 'exclusive'`).
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
- `/testing`: `PaylovFakeSurface` takes an optional second type argument naming the methods scripted
  with what the gateway sends; `fake.holds` is
  `PaylovFakeSurface<HoldsResource, { readonly create: TransactionReference }>`.
  `createWebhookRequest` sends `params.status: 'cancelled'`, which the receiver requires.
- `/testing`: the simulated `PaylovFakeGateway` answers `transactions.get` of a hold released by
  `holds.release`, before or after it expired: `refunded` with `isHold: true` and the release time
  as `cancelledAt`, as Paylov reports it. On the wire it reads `cancel` after a dismiss and
  `refunded` after the release a failed expired capture causes, as recorded.
- `/testing`: replies send the recorded wire shape: a PAN binding or PAN payment start carries
  `code: null` (and `extId: null` for a payment), and a card without a name sends `cardName: ""` and
  one without a bank name omits `bankName`. Script JSDoc and the testing guide describe each answer
  as one scripted attempt whose call result the SDK's retries, replay and decoding decide.
- A `validation_error` whose `data` nests deeper than 16 field segments keeps its code, status and
  outcome; the deeper paths are left out of `fields` instead of failing the call with a native
  `RangeError`.
- A call whose `signal` aborts while waiting no longer leaves an abort listener on that signal.

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

[0.0.6]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.6
[0.0.5]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.5
[0.0.4]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.4
[0.0.3]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.3
[0.0.2]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.2
[0.0.1]: https://github.com/IsroilovA/paylov-ts-sdk/releases/tag/v0.0.1
