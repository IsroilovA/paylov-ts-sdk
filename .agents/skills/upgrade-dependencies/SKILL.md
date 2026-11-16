---
name: upgrade-dependencies
description:
  Use when asked to check for or apply updates to paylov-ts-sdk dependencies, Node, or CI tooling.
---

# Upgrade dependencies

## Scope and inventory

- Respect the requested scope, exclusions, and check-only mode. Include necessary coupled
  dependencies; report conflicts with exclusions before changing them. Verification needs do not
  authorize unrelated upgrades or host software changes.
- For a full sweep, cover each surface; for narrower requests, inspect only the relevant
  declarations and consumers:
  - **npm:** `devDependencies` in `package.json` and `package-lock.json`.
  - **Node:** `.nvmrc`, `engines.node` (the supported floor), and the CI matrix. Raising the floor
    is a consumer-visible change.
  - **CI:** GitHub Actions in `.github/workflows/`, pinned by commit SHA with a version comment, and
    `.github/dependabot.yml`.

## Select and apply

- Check the registry, official release notes, and migration guides for the installed-to-target
  transition. Choose the newest stable supported set; report blocked upgrades and their constraints.
- Upgrade coupled packages together: `vitest` with `@vitest/coverage-v8`; `oxlint` with
  `oxlint-tsgolint` and `oxlint-plugin-complexity`; `typescript` with `@types/node` for the `.nvmrc`
  line.
- Check programmatic API consumers separately from CLIs: repository scripts import `oxc-parser`, and
  `tsdown` and Vitest load typed configuration files. CLI compatibility does not prove API
  compatibility.
- Edit `package.json` ranges and regenerate the lockfile with npm; never hand-edit it. Do not force
  incompatibilities through overrides or `--legacy-peer-deps`.
- Pin action upgrades to the release's full commit SHA, verified against the tagged release.
- Apply breaking changes directly without compatibility shims. A new linter rule or formatter change
  is fixed in code, never suppressed.
- Use new capabilities to simplify affected code; keep unrelated refactors out of scope.

## Verify and report

- Dependency changes are shared tooling: run `npm run check` (lint, typecheck, coverage, docs,
  architecture, secrets, build, packed consumer). Formatter upgrades also reformat the tree with
  `npm run format`.
- Distinguish code failures from download, environment, and upstream problems.
- Report changed versions, intentional holds, simplifications, checks, and gaps. Record
  consumer-visible changes (Node floor, emitted output) in `CHANGELOG.md`.
