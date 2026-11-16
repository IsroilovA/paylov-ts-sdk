Tests and fixtures. The `write-tests` skill owns test design.

## Suites

- Ordinary tests stay offline and inject the shared fake fetch. Sandbox calls belong only in
  `tests/live/` and skip only through the gates in `tests/helpers/live.ts`.
- Public compile-time contracts live in `tests/types/`, with positive and expected-failure cases.
- Keep adversarial casts local to malformed JavaScript inputs; narrow caught errors at runtime.
- Assert SDK errors with the shared helpers in `tests/helpers/asserts.ts`; add no per-suite
  variants.

## Fixtures

- The suffix names the source: `.wire.json` for redacted sandbox recordings, `.docs.json` for
  reference examples, `.bundle.json` for values replayed from Paylov's public sandbox bundle,
  `.synthesized.json` for constructed cases. Substituting canaries keeps the source suffix.
- A changed reference example updates its `.docs.json` fixture in the same change.
- A `.wire.json` is exactly
  `{ "capture": "NNN", "status": <int>, "headers"?: {...}, "body": <response> }`, `NNN` being the
  capture number of three or more digits; `headers` keeps only response headers the SDK reads. Never
  copy the capture's request. Replay it with `wireResponse()`; script any other fixture with
  `fixtureResponse()`. `.docs.json` and `.synthesized.json` files hold the body only; a
  `.bundle.json` holds the replayed values beside a `provenance` record.
- A `.wire.json` changes only through the redactions below. Amounts, balances, array rows, and
  totals stay as captured; a trimmed or edited body is a `.synthesized.json`.
- Every UUID in a `.wire.json` starts with `5eed`. Within one feature's fixtures, one capture id
  maps to one synthetic id. Replace user ids, RRNs, bind tokens, fiscal signs, and terminal ids with
  synthetic values; keep timestamps and bank names verbatim.
- Personal ids (phones, PINFLs, passport and bank account numbers) use a run of seven repeated
  digits (`88888888888888`, `ZZ0000000`) or contain the ascending `123456789` (`12345678901234`);
  `checkSecrets` accepts those and masked values.
- Credential canaries follow `EXAMPLE-...-NOT-A-REAL-...`. Use
  `EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON` for a cardholder and `EXPIRY-REDACTED` for a card expiry in
  responses. Request expiries must be `YYMM`, so tests send `9912`.
