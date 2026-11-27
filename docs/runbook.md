# Runbook

Maintainer procedures. Commands live in `package.json`; verification scope lives in the root guide.

## Local setup

Use the Node version from `package.json` and run `npm ci`.

## Sandbox credentials

1. Onboard only with maintainer approval, once, through [`PaylovOnboarding`](usage/onboarding.md):
   verify the single-use onboarding token Paylov issues and set the merchant `username` and
   `password` ([onboarding](paylov/authentication.md#onboarding)). Paylov returns `consumer_key` and
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
  an Uzcard `8600` card; defaults to the public `sandbox.paylov.uz` bundle);
  `PAYLOV_SPLIT_RECIPIENT_ID`, the split recipient Paylov issued the test merchant, for the splits
  write lane. The activity-type read lane always takes the test PINFL of that bundle's Uzcard card
  and skips when the bundle is unreachable.

Procedure:

1. Export the credentials from the secret store into the shell, never into a repository file.
2. Run the read lanes first:
   `PAYLOV_LIVE=1 PAYLOV_BASE_URL=https://dev.gw.paylov.uz npm run test:live`. A skip prints one
   reason; fix that reason rather than loosening a gate.
3. Add `PAYLOV_LIVE_WRITES=1`, `PAYLOV_LIVE_REFUND=1` or `PAYLOV_LIVE_SLOW=1` as needed. Write lanes
   delete the cards they bind and release the holds they leave open.
4. Read the `[paylov live] <label> {...}` lines. The live suite asserts both documentation-derived
   contracts and SDK behavior, so on an assertion failure first diagnose which artifact is wrong:
   the reference and its `.docs.json` fixture, the decoder, or the SDK. Record a contract finding,
   then fix the decoder and replace the fixture; fix an SDK defect in the SDK.
5. Record observations through the
   [sync-paylov-reference skill](../.agents/skills/sync-paylov-reference/SKILL.md) and update the
   matching [open question](paylov/open-questions.md).

## Probes

Repository-only probe scripts in [scripts/probes/](../scripts/probes/) send raw HTTP to DEV for
request shapes the SDK would refuse or reshape. The wrapper API, redaction and capture format are
documented in [probe.mjs](../scripts/probes/probe.mjs); the audit scanner in
[scanCaptures.mjs](../scripts/probes/scanCaptures.mjs). Captures are grade W evidence kept in the
git-ignored `captures/` and never committed: they hold unredacted DEV identifiers.

1. Copy [the placeholder env file](../scripts/probes/.env.example) to the gitignored `.env` at the
   repository root, or outside the repository, restrict it to mode `600`, and fill it from your own
   secret store. Double-quote every value: `--env-file` reads an unquoted `#` as a comment and
   silently truncates the value. Leave `PAYLOV_CAPTURE_DIR` unset to capture into `captures/`, and
   list every test card used in the run in `PAYLOV_LIVE_TEST_CARDS` and the test PINFL, phone and
   other secrets in `PAYLOV_PROBE_SECRETS` so copied data is redacted.
2. Run the read-only check first: `node --env-file=<env file> scripts/probes/checkSandbox.mjs`.
   Never probe wrong credentials.
3. Run other probes with `node --env-file=<env file> scripts/probes/<probe>.mjs`. State-changing
   probes track every card and hold they create for cleanup.
4. Audit the captures with `node --env-file=<env file> scripts/probes/scanCaptures.mjs`; with the
   same env file it reads the directory the probes wrote to. Back up the directory before a `--fix`
   run, then scan again to confirm zero hits.
5. If cleanup fails or a resource was created untracked or ambiguously, reconcile it by hand before
   the next run.
6. Delete temporary credential files. Promote evidence through the
   [sync-paylov-reference skill](../.agents/skills/sync-paylov-reference/SKILL.md) and the
   [fixture rules](../tests/AGENTS.md#fixtures).

## Release

Pushing to `main` releases: [`release.yml`](../.github/workflows/release.yml) runs the CI checks,
then publishes `package.json`'s version to npm unless that version is already there, then tags
`vX.Y.Z` and creates the GitHub release from the version's `CHANGELOG.md` section. For a version
already on npm, a later push only fills in a missing tag or release, at the commit npm recorded for
that version (`npm view <package>@<version> gitHead`). It fails without tagging when npm records no
commit, the remote tag cannot be read, or an existing tag points elsewhere; take that to the
maintainer. Never tag or publish by hand.

1. On `dev`, set the version and move `Unreleased` `CHANGELOG.md` entries under a dated
   `## [X.Y.Z] - YYYY-MM-DD` heading with its `[X.Y.Z]:` release link; `check:changelog` fails
   without them.
2. Run `npm run check` and review the complete release diff and the packed file list: built
   JavaScript, declarations and their source maps, usage docs, `package.json`, README, CHANGELOG and
   LICENSE, and nothing else.
3. Once CI passes on `dev`, obtain maintainer approval, then fast-forward `main` to `dev`. Release
   runs queue in push order, so the next fast-forward need not wait.

The job authenticates through npm trusted publishing and stores no token. The package's npm trusted
publisher names GitHub Actions, `IsroilovA/paylov-ts-sdk`, workflow `release.yml`, no environment,
and allows `npm publish`; without that permission it may only stage publishes and the job fails. A
publish failing with `E404` or `ENEEDAUTH` means that trust is missing or names another repository,
workflow or environment.

## Troubleshooting

- `sdk_config_error` on `baseUrl`: pass the bare origin, without `/merchant`.
- Live auth failures: check the four credentials and the account activation, then the token
  lifecycle. Use metadata-only logger hooks; never print credentials or responses.
