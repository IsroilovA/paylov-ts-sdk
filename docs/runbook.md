# Runbook

Maintainer procedures. Commands live in `package.json`; verification scope lives in the root guide.

## Local setup

Use the Node version from `package.json` and run `npm ci`.

## Sandbox credentials

1. Onboard only with maintainer approval; it is a one-time operator step outside the SDK. Verify the
   single-use onboarding token Paylov issues and set the merchant `username` and `password`
   ([onboarding](paylov/authentication.md#onboarding)). Paylov returns `consumer_key` and
   `consumer_secret` once; they are unrecoverable. Paylov may instead issue sandbox credentials
   directly.
2. Ask Paylov to activate the account; until then every token request fails.
3. Store all four credentials in the team secret store; never commit them.
4. Ask Paylov to register the webhook URLs and their Basic credentials. Callback verification needs
   a registered sandbox receiver URL.
5. Confirm the machine reaches `dev.gw.paylov.uz:443`; otherwise ask Paylov to allowlist its egress
   IP.

## Live sandbox suite

`npm run test:live` runs `tests/live/` against the DEV sandbox through the package entry point;
`npm test` and CI never run it. [tests/helpers/live.ts](../tests/helpers/live.ts) owns the gates and
what each enables; [sandboxConfig.mjs](../scripts/sandboxConfig.mjs) owns credential loading and the
DEV host allowlist. Variables:

- always: `PAYLOV_LIVE=1`, `PAYLOV_BASE_URL=https://dev.gw.paylov.uz`, `PAYLOV_CONSUMER_KEY`,
  `PAYLOV_CONSUMER_SECRET`, `PAYLOV_USERNAME`, `PAYLOV_PASSWORD`;
- write lanes: `PAYLOV_LIVE_WRITES=1`, optionally with `PAYLOV_LIVE_REFUND=1` or
  `PAYLOV_LIVE_SLOW=1`; `PAYLOV_LIVE_TEST_CARDS` (`PAN:YYMM:OTP` entries separated by `;`, including
  an Uzcard `8600` card; defaults to the public `sandbox.paylov.uz` bundle).

Procedure:

1. Export the credentials from the secret store into the shell, never into a repository file.
2. Run the read lanes first:
   `PAYLOV_LIVE=1 PAYLOV_BASE_URL=https://dev.gw.paylov.uz npm run test:live`. A skip prints one
   reason; fix that reason rather than loosening a gate.
3. Add `PAYLOV_LIVE_WRITES=1`, `PAYLOV_LIVE_REFUND=1` or `PAYLOV_LIVE_SLOW=1` as needed. Write lanes
   delete the cards they bind and release the holds they leave open.
4. Read the `[paylov live] <label> {...}` lines. An assertion failure means the
   documentation-derived contract is wrong: record it, then fix the decoder and replace the
   `.docs.json` fixture.
5. Record observations through the
   [sync-paylov-reference skill](../.agents/skills/sync-paylov-reference/SKILL.md) and update the
   matching [open question](paylov/open-questions.md).

## Probes

Repository-only probe scripts in [scripts/probes/](../scripts/probes/) send raw HTTP to DEV for
request shapes the SDK would refuse or reshape. The wrapper API, redaction and capture format are
documented in [probe.mjs](../scripts/probes/probe.mjs); the audit scanner in
[scanCaptures.mjs](../scripts/probes/scanCaptures.mjs). Captures are grade W evidence and never
enter the repository.

1. Copy [the placeholder env file](../scripts/probes/.env.example) to the gitignored `.env` at the
   repository root, or outside the repository, restrict it to mode `600`, and fill it from your own
   secret store. Double-quote every value: `--env-file` reads an unquoted `#` as a comment and
   silently truncates the value. Point `PAYLOV_CAPTURE_DIR` at an external directory, and list every
   test card used in the run in `PAYLOV_LIVE_TEST_CARDS` so copied card data is redacted.
2. Run the read-only check first: `node --env-file=<env file> scripts/probes/checkSandbox.mjs`.
   Never probe wrong credentials.
3. Run other probes with `node --env-file=<env file> scripts/probes/<probe>.mjs`. State-changing
   probes track every card and hold they create for cleanup.
4. Audit the captures with `node --env-file=<env file> scripts/probes/scanCaptures.mjs <dir>`. Back
   up the directory before a `--fix` run, then scan again to confirm zero hits.
5. If cleanup fails or a resource was created untracked or ambiguously, reconcile it by hand before
   the next run.
6. Delete temporary credential files. Promote evidence through the
   [sync-paylov-reference skill](../.agents/skills/sync-paylov-reference/SKILL.md) and the
   [fixture rules](../tests/AGENTS.md#fixtures).

## Release

Pushing to `main` releases: once CI passes, its `release` job publishes `package.json`'s version to
npm unless that version is already there, then tags `vX.Y.Z` and creates the GitHub release from the
version's `CHANGELOG.md` section. Never tag or publish by hand.

1. On `dev`, set the version and move `Unreleased` `CHANGELOG.md` entries under a dated
   `## [X.Y.Z] - YYYY-MM-DD` heading; the job fails without one.
2. Run `npm run check`; review the packed consumer result and the complete release diff.
3. Confirm the package contains built JavaScript and declarations, usage docs, README, CHANGELOG and
   LICENSE, and nothing else.
4. Once CI passes on `dev`, obtain maintainer approval, then fast-forward `main` to `dev`.

The job authenticates through npm trusted publishing: the package's npm settings trust this
repository's `ci.yml`. It stores no token; a publish failing with `E404` or `ENEEDAUTH` means that
trust is missing or names another repository or workflow.

## Troubleshooting

- Node below the package minimum: select the supported runtime before installing or checking.
- `sdk_config_error` on `baseUrl`: pass the bare origin, without `/merchant`.
- Live auth failures: check the four credentials and the account activation, then the token
  lifecycle. Use metadata-only logger hooks; never print credentials or responses.
