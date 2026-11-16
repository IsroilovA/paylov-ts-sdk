---
name: sync-paylov-reference
description:
  Use when absorbing Paylov documentation updates, team answers, or live DEV observations into the
  SDK reference. Excludes ordinary SDK implementation.
---

# Sync Paylov reference

## Scope

- Loading this skill authorizes no mirror replacement, commits, or external writes; follow the
  user's actual scope. Keep vendor syncs separate from feature work.
- Evidence flows from Paylov to the vendor mirror (`docs/vendor/paylov/`), the reference
  (`docs/paylov/`), fixtures, then implementation. Evidence grades are defined in
  `docs/paylov/README.md#evidence`.
- Read the affected reference pages and `docs/paylov/open-questions.md` first. Never resolve a
  contradiction by guessing or promote an observation into contract silently.

## Vendor documentation

1. List every page from `https://developer.paylov.uz/hashmap.json` (`ru_`/`uz_` keys are
   translations). Resolve canonical URLs from site links; unlinked pages may serve only at
   `<path>.html`.
2. Extract every English page into a temporary directory at `<url path>.md`: `source_url`
   frontmatter, verbatim body with byte-identical code blocks, and `## Notes (extraction)` listing
   source bugs and every factual EN/RU/UZ difference. Never fix the source text.
3. Have a separate agent re-fetch every page and correct the extraction. Without that pass, report
   the mirror as unverified.
4. Replace `docs/vendor/paylov/` wholesale with the verified extraction and its index `README.md`,
   in its own commit: `docs(vendor): sync paylov docs`.

## Reference updates

1. Update the owning reference pages, their `## Deviations from vendor docs`, and links into the
   mirror. Record a team answer on its owning page with date, source, and exact wording.
2. Remove answered questions and their `[OPEN Qn]` markers across `docs/`, `src/`, and `tests/`.
   Never reuse an id.
3. Update affected fixtures following `tests/AGENTS.md`.
4. Report SDK impact: none, additive, or breaking. Implementation, with any architecture update it
   needs, is separately authorized work.

## Live observations

- Run the live suite or probes against DEV following `docs/runbook.md`.
- Keep each redacted capture in the maintainer's numbered capture set outside the repository and
  cite it on the owning page as `W (cNNN)`. A capture records the UTC timestamp, SDK commit,
  environment, method and path without query values, auth mode, HTTP status, and the minimum
  field-level evidence. A money observation needs an independently known tiyin amount.
- Never commit raw bodies, credentials, PANs, card tokens, OTPs, PINFLs, phones, customer or account
  identifiers, names, addresses, or provider payloads. Evidence that cannot be redacted stays in the
  team's secure store; record only its reference.
- Observations never modify the mirror. A W fact becomes contract once its reference page,
  `.wire.json` fixtures, settled open questions, and SDK impact report are updated.
