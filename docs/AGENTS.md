Repository documentation.

## Owners

- [`paylov/`](paylov/): how Paylov works as a whole, for SDK users (often agents) and maintainers:
  flows, wire facts, units, codes, evidence, and deviations from the vendor docs. Unresolved
  behavior lives in `paylov/open-questions.md`. Consult it before re-researching Paylov.
- [`vendor/paylov/`](vendor/paylov/): verbatim mirror of the official developer docs, replaced
  wholesale through the `sync-paylov-reference` skill. Never edit it by hand; add no guide inside
  it.
- [`usage/`](usage/): consumer guides shipped in the package: integration flows and pitfalls. Method
  contracts live in JSDoc.
- [`architecture.md`](architecture.md): scope, boundaries, transport, authentication, error, money,
  and recovery decisions and their rationale.
- [`runbook.md`](runbook.md): maintainer procedures. Tool usage lives in the tool's module JSDoc.
- Release history: `../CHANGELOG.md`.

## Authoring

- Describe the current state in present tense. Replace outdated text; never narrate how it changed.
  Dates appear only as evidence citations.
- Before removing content, preserve unique constraints and open questions in their owner, then
  repair inbound links and anchors.
- `architecture.md` and `runbook.md` hold only what code cannot show: decisions, the rationale that
  prevents a wrong fix, and procedures.
- `paylov/` records Paylov behavior in full, not SDK design. Every fact carries an evidence grade
  from [`paylov/README.md`](paylov/README.md#evidence); record observations apart from contract.
- Usage pages stay short and indexed in `usage/INDEX.md`. They cover what types and JSDoc cannot:
  call order, recovery, units, and pitfalls. They import from the package root, use
  `https://gateway.example` with named credential variables, and link only to shipped files.
- Keep task research and verification reports in the conversation or requested PR. Remove resolved
  open questions instead of archiving them.
