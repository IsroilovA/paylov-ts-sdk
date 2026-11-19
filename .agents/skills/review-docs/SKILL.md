---
name: review-docs
description:
  Use only when explicitly asked to review, audit, or clean up paylov-ts-sdk guides, skills,
  `docs/`, or `README.md`.
---

# Review docs

## Scope

- Each surface's reader and owner are set in `docs/AGENTS.md#owners`; writing rules live in the root
  `AGENTS.md` Guides section and `docs/AGENTS.md#authoring`. Judge every file by them.
- `docs/vendor/paylov/` is read-only evidence. Changing reference facts beyond corrections follows
  the `sync-paylov-reference` skill.

## Verify

- Check every claim against its source: guides, skills, `architecture.md`, and `runbook.md` against
  code, `package.json`, scripts, and CI; usage names and samples against the package-root and
  `/testing` exports; `docs/paylov/` against the vendor mirror and fixtures.
- Fix a wrong claim only with evidence. Never fill a gap with a guess: an unsupported Paylov claim
  is removed or becomes an `[OPEN Qn]` question.

## Cut

- History and narration, restated code and inventories, duplicates (keep one home and link to it),
  filler and hedging, obvious advice, and unsupported speculation.
- Before removing a fact, confirm it is wrong, duplicated, or owned elsewhere. Deduplication tends
  to drop graded maintainer decisions; keep each in its owner.

## Parallel reviews

- Split work by file; each agent edits only its own files and reports problems in others.
- When several agents rewrite `docs/paylov/`, finish with one agent consolidating the whole set: one
  home per fact, one page structure and vocabulary, a README that orients the reader.

## Check and report

- List evidence tokens that the review removed from `docs/paylov/` entirely; each must be wrong or
  its question settled:

  ```sh
  git diff <base> -- docs/paylov | grep -E '^-' \
    | grep -oE '\bc[0-9]{3,}\b|Q[0-9]+\b|M [0-9]{4}-[0-9]{2}-[0-9]{2}|live run [0-9-]{10}' \
    | sort -u | while read -r token; do grep -rqF -- "$token" docs/paylov || echo "$token"; done
  ```

- Run `npm run format` and `npm run check:docs`, then `check:architecture` and `check:secrets`.
  Documentation-only changes need no behavior tests.
- Report errors fixed with evidence, categories cut, anchors changed, and the decisions left for the
  maintainer.
