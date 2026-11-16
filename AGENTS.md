Server-side TypeScript SDK for the Paylov payment gateway.

## Guides

- `AGENTS.md` is canonical; adjacent `CLAUDE.md` files symlink to it. Skills live in
  `.agents/skills/<name>/`; `.claude/skills/<name>` entries symlink to them.
- Guides apply cumulatively from the root to the nearest directory; nearer guides override parents
  only explicitly. Give each rule one home: the owning guide, or a parent when shared.
- Write English only, without emojis or filler. Open each guide with its surface; use `##` sections
  and lists, not tables.
- State constraints on future changes, not descriptions of current wiring phrased as rules. Omit
  obvious advice, implementation inventories, status, history, and roadmap; link source for
  navigation. Keep rationale only when it prevents a wrong fix.
- Do not cross-link guides to restate applicability; inheritance covers it.

## Ownership

- [`src/`](src/): the package source. [`tests/`](tests/): unit, type, and live suites with fixtures.
- [`docs/`](docs/): Paylov reference, consumer usage guides, architecture, and the runbook.
- [`scripts/`](scripts/): repository checks and DEV probe tooling; never shipped.
- [`examples/`](examples/): runnable consumer examples, typechecked and packed by
  `scripts/checkPackage.mjs`.

- Code and configuration own exact details; documents link to them instead of restating them.
  [`docs/AGENTS.md`](docs/AGENTS.md) maps which document owns the rest.

## Code

- Follow the runtime and module contract in `package.json`. Add no runtime dependencies.
- No `any` or unsafe production assertions. Decode external values from `unknown`.
- Use explicit public types, camelCase names, and verb methods. Money fields end in `Tiyin` (`Cents`
  only for USD checkout amounts); public money is a non-negative safe integer in the minor unit. Use
  the shared money guards and converters.
- Relative ESM imports end in `.js`; built-ins use `node:`. Code, script, and fixture filenames use
  camelCase; Markdown docs and skill directories use kebab-case, apart from conventional uppercase
  names such as `README.md`.
- Code is the primary documentation: prefer clear names, types, and flat control flow over comments.
- Reduce branching and nesting. Introduce types or helpers only for cohesive behavior, invariants,
  reuse, or necessary test seams; never split solely to satisfy the complexity limits in
  `.oxlintrc.json`, and never raise or suppress those limits.
- Secrets and personal data never enter logs, errors, fixtures, or commits. Examples use named
  credential variables; fixtures use unmistakable canaries.

## Contracts

- Read the owning `docs/paylov/` page and fixtures before endpoint changes. Never guess undocumented
  behavior; track it as an `[OPEN Qn]` question in `docs/paylov/open-questions.md`.
- Never edit `docs/vendor/paylov/` outside an explicitly authorized vendor sync.
- Unreleased: replace, never deprecate. No compatibility shims, dual paths, or migration notes.
- Refactor first so the change fits, then make it.
- Public contract or invariant changes need maintainer approval before code; an approval covers its
  agreed scope.
- Consumer-visible changes update the affected usage docs, their index, JSDoc, type contracts, and
  `CHANGELOG.md`.

## Verification

- Run the affected tests and static checks; reuse passing results until invalidated.
- Run `npm run check` before handing off runtime, public-contract, or shared-tooling changes.
  Documentation-only changes need formatting, not behavior tests.
- Never weaken the coverage floors in `vitest.config.ts` or the report checks in
  `scripts/checkCoverage.mjs`, and add no tests solely for coverage.

## Workflow

- Create no branch, commit, issue, PR, tag, or push without authorization.
- Use Conventional Commits and `feat/<topic>`, `fix/<topic>`, or `refactor/<topic>` branches.
- Base branches and PRs on `dev`; prefer squash merges into it. Never commit directly to `main`;
  fast-forward `dev` into it with `git push origin origin/dev:main`.
- Report only phase changes, blockers, consequential findings, and needed decisions. Final responses
  state outcome, changed paths, verification, and unresolved items.
