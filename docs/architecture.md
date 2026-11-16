# Architecture

Consequential decisions and the rationale that prevents a wrong fix. Code owns signatures, fields,
defaults, and module inventories; [usage](usage/INDEX.md) owns consumer-visible behavior;
[paylov/](paylov/README.md) owns wire facts.

## Package boundary

- A server-only ESM package. Credentials stay on the backend; browsers receive only checkout and
  Card Bind URLs.
- Methods that take a full card number are opt-in surfaces named `Pan`, with a PCI-scope warning in
  their JSDoc; the PAN never reaches logger events or errors. Card Bind and the hosted checkout page
  are the default paths.
- Zero runtime dependencies limit the payment supply chain. Framework adapters belong in consuming
  applications.
- The `/testing` fake gateway answers at the `fetch` boundary, so applications test the real
  transport and decoders. It never simulates gateway state, because most state transitions are
  undocumented. It records each request decoded back into the method's own params, so tests assert
  sent values in SDK units without wire names; it never keeps passwords and never puts requests in
  errors.
- Consumer guides ship with the package, so integrators work from types, JSDoc and usage guides
  without the internal Paylov reference. The README links only to shipped files.

## Scope

Every Paylov endpoint with a verified or documented success shape is in scope, apart from these
features, which the SDK's applications do not need:

- A2C payouts (`/merchant/a2c/`), including payout reads and the deposit balance.
- Card history and card history logs.
- The PINFL ownership check (`userCard/checkPinflMatch/`).
- The official profile (`userCard/createOfficialProfile/`), whose only documented purpose is A2C.
- Service payments (`servicePayment/`, `sub/servicePayment/`).

The reference keeps no research or open questions for them; adding one starts from the vendor
mirror. Transaction rows still decode `isA2c`, the `merchant.deposit` webhook still reports an A2C
deposit source, and holds keep their optional `serviceId`: those are data of supported surfaces.

Any other endpoint without a known success shape stays out until Paylov documents one, because a
decoder would have to guess; [paylov/README.md](paylov/README.md#surface-outside-the-sdk) lists them
with reasons. GraphQL account sign-in stays out because it would hold end-user credentials. The
internal-checkout GraphQL backend stays out: it is undocumented and credential-free, and
`createCheckoutUrl` and the `payments` PAN methods cover its uses through documented APIs.

## Layers

- Features never import each other or the auth modules, and use only the call helpers and pure core,
  so none can build a transport that bypasses authentication or `close()`. Pure core (types, errors,
  errorCodes, money, decoding, time, params, fake) imports only pure core; `shared/`, the checkout
  link and the webhook receiver use only pure core, so they stay transport-free.
- Fakes load only from other fakes and the testing surface, so no fake encoder reaches production
  code paths. Only `core/http.ts` calls the platform `fetch`.
- Transports are separate so authentication cannot recurse or leak: the token manager's transport
  has neither auth nor the client lifecycle, so grants never recurse and revocation still runs after
  `close()`. `gateway.getStatus` uses an anonymous transport. `PaylovOnboarding` uses a
  credential-free transport and never touches the token manager.
- [checkArchitecture.mjs](../scripts/checkArchitecture.mjs) and the oxlint `fetch` restriction
  enforce these rules.

## Responses and errors

- Each endpoint declares its success shape; the SDK never guesses it. Failures decode from the
  envelope everywhere.
- Errors are classified by origin, as a union discriminated by `kind`: input (a caller value or the
  configuration broke a rule, before I/O), closed (client lifecycle state, which also ends a replay
  after `close()`), API (a gateway code), protocol (an undecodable or unexpected response) and
  connection (timeout, network, abort). Never infer a class from a code's name; unknown codes stay
  plain API errors.
- `isPaylovOutcomeUnknown` is the one definition of an ambiguous failure. Docs and JSDoc refer to it
  instead of restating the predicate. A connection error records whether any attempt reached fetch
  (`isSent`), because an abort before that provably sent nothing.
- Decoders report failures as an internal decode failure carrying only the path. It becomes a public
  protocol error only where a response exists; the webhook receiver maps it to an outcome. Any other
  exception from a decoder is an SDK bug and propagates.
- API errors never read `message`, which Paylov documents as display text not to be parsed, and
  never give a code a meaning by HTTP status, which Paylov does not document: callers branch on
  `code`.
- A method maps a code to a value only when it is a verified not-found answer. `phone_not_match` is
  not one: DEV answers it for the card's own phone too ([cards](paylov/cards.md)).
- Errors and logger events carry allowlisted metadata only, because key-based redaction cannot make
  arbitrary payload strings safe.
- Caller input is checked only for presence and type, the money invariant, path and checkout-link
  safety, and SDK configuration. Paylov owns business validation (bounds, lengths, formats, id
  shapes): a local copy drifts from the gateway, whose limits are mostly measured on DEV alone, and
  makes callers handle one failure in two shapes (`sdk_invalid_input` and the gateway's code).
- Response decoders establish the public type and the conversions the SDK owns: money units,
  timestamps of known zone, `…Raw` text and status words. For the same reason they do not re-check
  Paylov's invariants (id shapes, non-empty text, echoed statuses, cross-field consistency). The
  remaining checks guard SDK promises:
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

- `baseUrl` has no default host.
- Failure retries are GET-only. POST and DELETE never retry: a lost response does not prove the
  operation did not execute.
- Nothing retries a 429: the gateway asks for tens of seconds, so callers read `retryAfterSeconds`.
  A 429 whose body read fails stays a 429, so it still starts the token cool-down.
- One re-authentication replay follows a 401 carrying the enveloped `permission_denied`, for any
  method. Replaying a POST is safe because Bearer authentication rejects before the handler runs: a
  `hold/create` refused with 401 for a superseded or malformed token left no transaction, while the
  same body with a valid token created a hold (W c1493–c1505,
  [Bearer failures](paylov/authentication.md#bearer-failures)). A bare 401 comes from a proxy,
  proves nothing about the token, and is never replayed.
- A caller's abort is final and abandons only that caller's wait on a shared token grant, never the
  grant.
- Redirects are not followed. Deadlines cover body reading even when an injected fetch ignores
  abort. Logger failures never delay or fail a request.
- The transport receives the declared endpoint and fills its route itself, so logs and errors name
  the route template and never a filled path.

## Authentication lifecycle

- Tokens are lazy, process-local and single-flight. Token generations stop a stale 401 from
  invalidating a newer token. A rejected refresh falls back to one password grant; connection
  failures do not.
- Only `invalid_grant` from the password grant locks the client, because repeated failed attempts
  can lock the merchant account. Recovery is a new client.
- A token-endpoint 429 starts a cool-down without I/O instead of a lock.
- `close()` waits for an in-flight grant, revokes the newest token, and always resolves once closed
  locally; a failed revocation appears only in logger events and leaves the token valid until it
  expires. Later calls throw `sdk_client_closed`. It does not wait for requests already sent:
  production revocation is assumed immediate
  ([authentication](paylov/authentication.md#revoke-tokens)), so one still in flight may answer 401
  and its single replay fails with `sdk_client_closed`. The 401 proves it never ran, so draining is
  left to the caller.
- One long-lived client per credential set per process. A shared token cache cannot coordinate
  rotation safely, because a refresh invalidates the old refresh token; distributed auth needs a
  separately approved design with locking and time bounds.

## Money and time

- Public money is a minor-unit integer. Each feature declares its endpoint's wire unit; shared
  readers validate and convert once, rejecting values the wire cannot represent exactly.
- Amount bounds are Paylov's ([Responses and errors](#responses-and-errors)). Money whose unit is
  not stated is withheld, never inferred.
- Timestamps become `Date` only where the zone is known; others stay strings in `…Raw` fields. Zones
  per field: [usage/money-and-time.md](usage/money-and-time.md#dates-and-times).

## Holds and recovery

- Capture is single-use and may be partial; the remainder can then be neither captured nor released
  through the API, and is treated as released to the cardholder by Paylov and the card's bank (M,
  [holds](paylov/holds.md#charge)). Callers keep the original held amount.
- Dismiss is the only documented release, so it is the proof of release: callers release every hold
  they will not capture, also after it expires, and `hold_not_found` reads as nothing left to
  release (M, [holds](paylov/holds.md#dismiss)). No expiry-based release is inferred from status
  reads, which kept reporting expired holds as held on DEV.
- Nothing that moves money is retried automatically. After an ambiguous failure callers reconcile
  through a read and retry with the same `externalId` ([usage/errors.md](usage/errors.md)).
- A reconciliation read returns `null` only on its verified not-found code; every other miss throws.
  `fiscalization.getReceipt` returns `null` for a known transaction without a receipt and for an
  unknown `externalId`, which names the receipt itself; an unknown `transactionId` throws.
  `splits.get` throws on a miss because no not-found code is verified.
- A refund receipt comes from `payments.refund`, which cancels the payment's fiscalization;
  `refundReceipt` runs only when `getReceipt({ isRefund: true })` then shows none. The docs reserve
  the direct refund for that case ([fiscalization](paylov/fiscalization.md#refund-fiscal-receipt)),
  and calling it first risks two refund receipts for one sale.

## Callbacks

- The receiver is framework-neutral and stateless. Invalid input is a secret-safe `invalid` outcome;
  the host application owns the HTTP failure response, because Paylov documents none. Deduplication
  belongs to the application.
- Check and perform are answered with a semantic decision that maps to the documented status.
- Only integer minor-unit fields supply money; the whole-currency `amount` is ignored. The checkout
  link is unsigned, so check handlers re-validate amount, currency and account.
- The Card Bind webhook surfaces only the card id: the rest is unauthenticated processor data and
  the webhook is never retried, so the authenticated `cards.get` read is the source of truth.

## Contract eligibility

- A new public contract needs traceable Paylov evidence, reference and fixture updates, and
  maintainer approval. No experimental namespace or raw-response escape hatch bypasses this.
- Live DEV evidence (grade W) beats the docs where they disagree; production may differ, so a
  changed shape fails loudly with its path.
