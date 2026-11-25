# Architecture

Consequential decisions and the rationale that prevents a wrong fix.

## Package boundary

- A server-only ESM package. Credentials stay on the backend.
- Methods that take a full card number are named `Pan`, with a PCI-scope warning in their JSDoc; the
  PAN never reaches logger events or errors.
- Zero runtime dependencies limit the payment supply chain. Framework adapters belong in consuming
  applications.
- The `/testing` fake gateway answers at the `fetch` boundary, so applications test the real
  transport and decoders. By default it answers only scripted calls. Its opt-in simulation keeps
  cards, payments, transactions and holds in memory and encodes only transitions observed on DEV;
  any other state answers `fake_unsimulated` and fails `assertDone()`, because most transitions are
  undocumented and a guessed one would let application tests pass against behavior Paylov never
  showed. Scripted answers take precedence over the simulation. It records each request decoded back
  into the method's own params, so tests assert sent values in SDK units without wire names; it
  never keeps passwords and never puts requests in errors.
- Consumer guides ship with the package, so integrators work from types, JSDoc and usage guides
  without the internal Paylov reference.

## Scope

Every Paylov endpoint with a verified or documented success shape is in scope, apart from these
features, which the SDK's applications do not need:

- A2C payouts (`/merchant/a2c/`), including payout reads, the deposit balance and the
  `merchant.deposit` webhook.
- Card history and card history logs.
- The PINFL ownership check (`userCard/checkPinflMatch/`).
- The official profile (`userCard/createOfficialProfile/`), whose only documented purpose is A2C.
- Service payments (`servicePayment/`, `sub/servicePayment/`).
- Hosted card binding, where the cardholder enters the card on Paylov's Card Bind page: bind links
  (`userCard/createBindLink/`), bind session reads (`userCard/bindSession/{token}/status/`) and the
  Card Bind webhook.
- Hosted checkout, where the customer pays on Paylov's page: the Checkout API, Create Payment Link
  and the `transaction.check` / `transaction.perform` callbacks.
- Cash-sale fiscal receipts (`fiscalization/register/` by `externalId` and `phoneNumber`, and their
  `externalId` status reads): the applications take no cash.
- Client-side fiscal receipts (`fiscalization/set-receipt/`): the applications run no cash register
  or OFD provider of their own.

The reference keeps no open questions for them, and no research apart from the hosted-checkout, Card
Bind, fiscalization and A2C `merchant.deposit` facts in [paylov/checkout.md](paylov/checkout.md),
[paylov/cards.md](paylov/cards.md), [paylov/fiscalization.md](paylov/fiscalization.md) and
[paylov/callbacks.md](paylov/callbacks.md#merchantdeposit); adding one starts from the vendor
mirror. Transaction rows still decode `isA2c`, and holds keep their optional `serviceId`: those are
data of supported surfaces.

Any other endpoint without a known success shape stays out until Paylov documents one, because a
decoder would have to guess; [paylov/README.md](paylov/README.md#surface-outside-the-sdk) lists them
with reasons. GraphQL account sign-in stays out because it would hold end-user credentials. The
internal-checkout GraphQL backend stays out: it is undocumented and credential-free, and the
`payments` PAN methods cover its card-payment use through documented APIs.

## Layers

- Features never import each other or the auth modules, and use only the call helpers and pure core,
  so none can build a transport that bypasses authentication or `close()`. Pure core (no I/O,
  credentials or client state) imports only itself; `shared/` and the webhook receiver use only pure
  core, so they stay transport-free.
- Fakes load only from other fakes and the testing surface, so no fake encoder reaches production
  code paths. Only `core/http.ts` calls the platform `fetch`.
- Transports are separate so authentication cannot recurse or leak: the token manager's transport
  has neither auth nor the client lifecycle, so grants never recurse and revocation still runs after
  `close()`. `gateway.getStatus` uses an anonymous transport. `PaylovOnboarding` uses a
  credential-free transport and never touches the token manager.
- [checkArchitecture.mjs](../scripts/checkArchitecture.mjs) and the oxlint `fetch` restriction
  enforce these rules and own the module lists.

## Responses and errors

- Each endpoint declares its success shape; the SDK never guesses it. Failures decode from the
  envelope everywhere.
- Errors are classified by origin, as a union discriminated by `kind`: input (a caller value or the
  configuration broke a rule, before I/O), closed (client lifecycle state, which also ends a replay
  after `close()`), API (a gateway code), protocol (an undecodable or unexpected response) and
  connection (timeout, network, abort). Never infer a class from a code's name; unknown codes stay
  plain API errors.
- An ambiguous failure has one carrier: `isOutcomeUnknown`, set when the error is built and read
  through `isPaylovOutcomeUnknown`. Docs and JSDoc refer to the predicate instead of restating it.
  Each endpoint declares its effect (`read`, `write`, `money`), and the response context carries it,
  so neither the predicate nor the transport matches routes. A read is never ambiguous: its
  reconciliation must not need reconciling. A write is ambiguous after a 5xx, a protocol error, or a
  connection failure once sent. On a `money` endpoint the generic codes `processing_error`,
  `unknown_error` and `error_at_pay` count too: they name no reason, and Paylov documents neither
  their triggers nor whether money moved (a maintainer decision). Specific declines stay definitive.
  Methods sharing a route with different effects (`splits.create`, `splits.resendReceipt`) declare
  separate endpoints.
- The flag describes the requested operation, not the request that failed. A token-grant failure
  keeps the token endpoint and code for diagnostics but stays known, as does an abort after a 401
  rejection and before its replay: no attempt that could execute the operation was sent. A grant's
  error is shared by its waiters, the password latch and the cool-down, so each caller gets its own
  copy, known outcome or not: an application decorating one error must not change another's. GET
  endpoints are reads by type, so a retried attempt never leaves anything to reconcile. `isSent`
  stays a plain transport fact: whether any attempt of the call reached fetch.
- Decoders throw an internal decode failure carrying only the path, or an internal decoded miss
  carrying the gateway's not-found code for a success body that means a miss. `decodePayload` is the
  only converter of either into a public error, and runs only where a response exists; the webhook
  receiver maps a decode failure to an outcome. Any other exception from a decoder is an SDK bug and
  propagates.
- API errors never read `message`, which Paylov documents as display text not to be parsed, and
  never give a code a meaning by HTTP status, which Paylov does not document: callers branch on
  `code`.
- A method maps an error code to a value only where the code is the method's documented answer:
  `invalid_or_expired` is `PaylovOnboarding.checkToken`'s `false`. A lookup miss stays an error.
  `phone_not_match` is no such answer: DEV answers it for the card's own phone too
  ([cards](paylov/cards.md)).
- Errors and logger events carry allowlisted metadata only, because key-based redaction cannot make
  arbitrary payload strings safe.
- Caller input is checked only for presence and type, the money invariant, path safety, and SDK
  configuration. Paylov owns business validation (bounds, lengths, formats, id shapes): a local copy
  drifts from the gateway, whose limits are mostly measured on DEV alone, and makes callers handle
  one failure in two shapes (`sdk_invalid_input` and the gateway's code).
- Response decoders establish the public type and the conversions the SDK owns: money units,
  timestamps of known zone and status words. For the same reason they do not re-check Paylov's
  invariants (id shapes, non-empty text, echoed statuses, cross-field consistency). The remaining
  checks guard SDK promises:
  - a masked card number, because anything else may be a full PAN;
  - the id `transactions.get` echoes, because without a usable id the endpoint lists other
    transactions.
- A status word that transaction and hold reads share names the same state on both. Wire spellings
  whose meanings Paylov has not settled read as one word instead of a guessed distinction: a
  transaction's `cancel` and `refunded` both read `refunded`; for a hold, `holds.get` tells a
  release from a capture.
- One undecodable row fails its whole list, because a skipped row would hide a bound card or a
  transaction. The webhook receiver stays strict: its input is untrusted.

## Transport

- Failure retries are GET-only. POST and DELETE never retry, whatever `maxGetRetries` says: a lost
  response does not prove the operation did not execute. The GET retry count is bounded so a
  misconfiguration cannot turn one read into a request storm.
- Nothing retries a 429: the gateway asks for tens of seconds, so callers read `retryAfterSeconds`.
  A 429 whose body read fails stays a 429, and any 429 keeps its `Retry-After` delay whatever its
  body holds, a delay in the body included, so it still starts the token cool-down for that long. A
  429 is never a credential verdict: no `invalid_grant` it carries latches the client or falls back
  to the password grant.
- One re-authentication replay follows a 401 carrying the enveloped `permission_denied`, for any
  method. Replaying a POST is safe because Bearer authentication rejects before the handler runs: a
  `hold/create` refused with 401 for a superseded or malformed token left no transaction, while the
  same body with a valid token created a hold (W c1493–c1505,
  [Bearer failures](paylov/authentication.md#bearer-failures)). A bare 401 comes from a proxy,
  proves nothing about the token, and is never replayed; nor is an envelope without `result: null`,
  which contradicts the documented rejection and so does not prove the request did not execute.
- A caller's abort is final and abandons only that caller's wait on a shared token grant, never the
  grant.
- Redirects are not followed. Deadlines cover body reading even when an injected fetch ignores
  abort. Logger failures never delay or fail a request.
- The transport receives the declared endpoint and fills its route itself, so logs and errors name
  the route template and never a filled path.
- The transport runs the endpoint's decoder before it emits the attempt's response event, so the
  event reports a 2xx that breaks the method's contract, and an unacknowledged revocation, which
  nothing else reports. A miss decoded from a success body is a successful exchange and logs no
  code.

## Authentication lifecycle

- Tokens are lazy, process-local and single-flight. Token generations stop a stale 401 from
  invalidating a newer token. A rejected refresh falls back to one password grant; connection
  failures do not.
- Only `invalid_grant` from the password grant locks the client, because repeated failed attempts
  can lock the merchant account. Recovery is a new client.
- A token-endpoint 429 starts a cool-down without I/O instead of a lock.
- `close()` waits for an in-flight grant, revokes the newest token, and always resolves once closed
  locally; a failed revocation, or one answered with anything but the recorded acknowledgement,
  appears only in logger events and leaves the token valid until it expires. Later calls throw
  `sdk_client_closed`. It does not wait for requests already sent: production revocation is assumed
  immediate ([authentication](paylov/authentication.md#revoke-tokens)), so one still in flight may
  answer 401 and its single replay fails with `sdk_client_closed`. The 401 proves it never ran, so
  draining is left to the caller.
- One long-lived client per credential set per process. A shared token cache cannot coordinate
  rotation safely, because a refresh invalidates the old refresh token; distributed auth needs a
  separately approved design with locking and time bounds.

## Money and time

- Public money is a minor-unit integer. Each feature declares its endpoint's wire unit; shared
  readers validate and convert once, rejecting values the wire cannot represent exactly.
- Amount bounds are Paylov's ([Responses and errors](#responses-and-errors)). Money whose unit is
  not stated is withheld, never inferred.
- Timestamps become `Date` only where the zone is known; a timestamp of unknown zone is withheld,
  like money of unknown unit. Zones per field:
  [usage/money-and-time.md](usage/money-and-time.md#dates-and-times).

## Holds and recovery

- A partial capture's remainder counts as released ([holds](paylov/holds.md#charge)); callers keep
  the original held amount.
- `holds.create` reports `clientCaptureDeadline`, read from the client clock before the request is
  sent, so it can only precede the gateway's own creation time: a lower bound on expiry, never proof
  of release. `readHoldState` therefore reports `possibly_expired`, not `released`, once it passes.
- Dismiss is the only proof of release ([holds](paylov/holds.md#dismiss)): callers release every
  hold they will not capture, also after it expires. Release is never inferred from expiry or status
  reads.
- Nothing that moves money is retried automatically. After an ambiguous failure callers reconcile
  through a read and retry with the same `externalId` or `transactionId`, unless the read shows the
  call ran and failed ([usage/errors.md](usage/errors.md#recovery-after-an-ambiguous-failure)).
- A declined hold create leaves a record that consumes its `externalId`
  ([holds](paylov/holds.md#create)). `holds.get` reports it as `declined`. `readHoldState` answers
  its own kind only with the hold's `failed` transaction, the decline Paylov documents, so recovery
  stops repeating that `externalId` instead of retrying it forever without trusting the undocumented
  hold status alone.
- A lookup never resolves `null` for "not found": a miss throws the gateway's not-found code, so a
  caller cannot mistake a miss for an empty record and cannot skip it silently. Where Paylov reports
  a miss only through a success body (`transactions.get`'s empty list), the SDK throws that
  endpoint's not-found code itself (`transaction_not_found`, as `holds.get` does), definitive and
  never an unknown outcome. `null` remains only where it is a documented state, not a miss (a fiscal
  receipt not registered yet).
- A refund receipt comes from `payments.refund`, which registers it in the background;
  `refundReceipt` runs only when `getReceipt({ isRefund: true })` still shows none minutes later.
  The docs reserve the direct refund for that case
  ([fiscalization](paylov/fiscalization.md#refund-fiscal-receipt)); Paylov refuses it before the
  refund and once the refund receipt exists, so calling it first only adds a failing call.

## Callbacks

- The receiver is framework-neutral and stateless. Invalid input is a secret-safe `invalid` outcome;
  the host application owns the HTTP failure response, because Paylov documents none. Deduplication
  belongs to the application.
- The receiver accepts a list of credential pairs so a callback password can rotate without
  downtime. Every pair is compared in constant time, also after a match, so timing does not reveal
  which pair matched.
- Only the integer `amount_in_tiyin` supplies money; the whole-SUM `amount` is ignored.

## Contract eligibility

- A new public contract needs traceable Paylov evidence, reference and fixture updates, and
  maintainer approval. No experimental namespace or raw-response escape hatch bypasses this.
- Live DEV evidence (grade W) beats the docs where they disagree; production may differ, so a
  changed shape fails loudly with its path.
