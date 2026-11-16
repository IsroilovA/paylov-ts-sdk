Repository documentation.

## Layout

- [`paylov/`](paylov/): the Paylov API as researched for this SDK, its evidence, and open questions.
  Consult it before re-researching Paylov.
- [`vendor/paylov/`](vendor/paylov/): verbatim mirror of the official developer docs, replaced
  wholesale through the `sync-paylov-reference` skill. Never edit it by hand; add no guide inside
  it.
- [`usage/`](usage/): consumer guides shipped in the package.
- [`architecture.md`](architecture.md): consequential decisions and their rationale.
- [`runbook.md`](runbook.md): maintainer procedures: setup, sandbox, live suite, probes, release,
  troubleshooting.

## Authority map

- Paylov wire facts, units, codes, evidence, and deviations from the vendor docs: `paylov/`.
  Unresolved Paylov behavior: `paylov/open-questions.md`.
- Scope, boundaries, transport, authentication, error, money, and recovery decisions:
  `architecture.md`.
- Integration flows and pitfalls: `usage/`. Method contracts: JSDoc.
- Procedures: `runbook.md`. Tool usage: the tool's own module JSDoc.
- Release history: `../CHANGELOG.md`.
- Signatures, fields, defaults, routes, and inventories: code and configuration.

## Authoring

- Describe the current state in present tense. Replace outdated text; never narrate how it changed.
  Dates appear only as evidence citations.
- Keep one home per fact or procedure; elsewhere link to it. Before removing content, preserve
  unique constraints and open questions in their owner, then repair inbound links and anchors.
- Do not restate code. Link to the source instead of copying signatures, defaults, or inventories.
- `paylov/` records Paylov behavior, not SDK design. Every fact carries an evidence grade from
  [`paylov/README.md`](paylov/README.md#evidence); record observations apart from contract.
- Usage pages stay short and indexed in `usage/INDEX.md`. They cover what types and JSDoc cannot:
  call order, recovery, units, and pitfalls. They import from the package root, use
  `https://gateway.example` with named credential variables, and link only to shipped files.
- Keep task research and verification reports in the conversation or requested PR. Remove resolved
  open questions instead of archiving them.
