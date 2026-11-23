Production source.

## Contracts

- Only package-root and `/testing` exports are consumer contracts; internal module exports are not
  public API.
- Reject missing or mistyped runtime caller values with SDK errors before logging, authentication,
  or I/O. Check closed request literals; keep response unions open with `| (string & {})`.
- Check caller input only for presence, type, the money invariant, and path or link safety. Never
  copy Paylov's value rules (minimums, maximums, lengths, formats, id shapes)
  ([rationale](../docs/architecture.md#responses-and-errors)).
- Keep transport and envelope results `unknown` until the owning decoder establishes a type. Generic
  type arguments and assertions are not decoders.

## Features

- A feature folder holds `resource.ts` (the `<X>Resource` interface and its factory), `types.ts`
  (public types, type-only imports), `decoders.ts` when it decodes records, and `fake.ts`, which
  encodes each method's result as the inverse of its decoder and decodes each request back into the
  method's params as the inverse of its encoding; methods sharing an endpoint each pass a request
  matcher. Only fakes and `testing/` import a fake. Code two features use lives in `shared/`.
- A surface outside `PaylovClient` enters through `client.ts` (a class), `link.ts` (a pure function)
  or `receiver.ts`. A pure decision over a feature's read result lives in that feature's `state.ts`.
- Each surface declares its endpoints once, in an exported `ENDPOINTS` table of `as const`
  `Endpoint` literals. The resource and the testing fake both read it; never restate a route,
  method, or shape.
- Key each `ENDPOINTS` entry by the method that sends it; only an endpoint several methods share
  takes its wire name.
- A method opens with
  `const method = '<ns>.<name>'; const { input, signal } = readCall(params, options, method);`,
  builds the body or query, and returns `send(http, ENDPOINTS.x, request, decodeX)` from
  `core/call.ts`, passing identifiers as `path` values. Map a miss to a value only with `orOnMiss`
  and an endpoint `miss` code. Add no local request, path, or recovery wrappers.
- Results and lookups of a transaction use the `shared/transactions.ts` types and readers.
- Response decoders are module-level `decodeX: Decoder<T>` constants in `decoders.ts`; each method
  calls exactly one. Only a decoder that checks an echoed request id is a factory
  (`decodeRequestedTransaction(transactionId)`). `asX` names are reserved for core primitives.
  Decode with the `core/decoding.ts` primitives, keeping wire names inside the owning feature.
- Decode into explicit camelCase types and omit undocumented fields. Never expose raw processor
  records, credentials, possible full PANs, or money of unknown unit.
- Decoders check only what the public type and the SDK's own conversions need. Never add id-shape,
  non-empty, or echo checks outside `webhooks/` beyond the exceptions in
  [architecture.md](../docs/architecture.md#responses-and-errors).
- A reconciliation read returns `null` on its verified not-found code; document any exception.
- Pass documented merchant-owned opaque request data through unchanged. Treat values as PANs or
  phones only in their documented field context; long numeric identifiers are not sensitive by
  themselves.

## Names

- Params are `<Verb><Noun>Params`, one per method. An action result is `<Noun><Participle>`
  (`HoldCaptured`) or the shared `TransactionReference`; a read result is the entity noun.
- Booleans read as predicates (`isActive`, `isCheckout`).
- The `Paylov` prefix marks only classes, configuration, errors, and core cross-cutting types.

## JSDoc

- A public method's JSDoc states its purpose; its money effect; a PCI line for full-PAN input; a
  recovery line for money-moving methods; `@throws {@link PaylovApiError}` with the codes worth
  branching on; and one short, safe, actionable `@example` calling the `paylov` client. Parameter
  rules live on the parameter fields; interface-level docs do not repeat method docs.
- The PCI line opens with `PCI scope: takes a full card number server-side;` and states what the SDK
  keeps out of logger events and errors.
- Public JSDoc states facts in plain words: no `[OPEN Qn]` ids and no `docs/paylov/` paths, which do
  not ship.

## Comments

- Comment only constraints the code cannot express, such as a Paylov quirk or a security reason.
  Internal `//` comments cite `[OPEN Qn]` for undocumented behavior. No narration, restated code,
  history, or file-header one-liners that restate the feature layout.
