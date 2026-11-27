# Setup

## Requirements

- Install from npm: `npm install @isroilov_an/paylov` ([README](../../README.md#install)).
- Node >= 24.13.1, ESM only: use `import` or `await import()`, never `require`.
- TypeScript `moduleResolution` `node16`, `nodenext` or `bundler`.
- Four credentials (`consumerKey`, `consumerSecret`, `username`, `password`), issued once through
  [onboarding](onboarding.md) and activated by Paylov. Keep them in a secret manager.
- Paylov allowlists source networks: ask it to allow each egress IP that calls the gateway.

## Create the client

```ts
import { PaylovClient } from '@isroilov_an/paylov';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing env var ${name}`);
  return value;
}

export const paylov = new PaylovClient({
  baseUrl: required('PAYLOV_BASE_URL'),
  consumerKey: required('PAYLOV_CONSUMER_KEY'),
  consumerSecret: required('PAYLOV_CONSUMER_SECRET'),
  username: required('PAYLOV_USERNAME'),
  password: required('PAYLOV_PASSWORD'),
});
```

- `baseUrl` is a bare origin: development `https://dev.gw.paylov.uz`, production
  `https://gw2.paylov.uz`. The `.../merchant` URL the dashboard shows is rejected. Paylov does not
  document how production differs in test cards or limits.
- Keep one long-lived client per credential set per process; tokens are not shared between
  processes.
- Wrong credentials surface on the first authenticated call as `invalid_grant`
  ([errors.md](errors.md#credentials-and-access)).
- Call `close()` on shutdown, after your own requests have settled: it revokes the access token, and
  a request still in flight may then fail with `sdk_client_closed`, without effect. On the
  development gateway a revoked token keeps working. `close()` resolves even when revocation fails
  or Paylov does not acknowledge it; only the logger events report that, and the token's validity is
  then uncertain: it may stay valid until it expires.
- `close()` does not invalidate the refresh token, which stays valid for up to 30 days. If a
  credential or token leaks, notify Paylov support, which revokes the credentials.

## Check your sandbox setup

Run once from an allowlisted network with your DEV credentials and
`PAYLOV_BASE_URL=https://dev.gw.paylov.uz`. `getStatus` proves only that the gateway answers;
`listBanks` also proves the credentials. Report the count, never tokens or bodies.

```ts
try {
  await paylov.gateway.getStatus({ signal: AbortSignal.timeout(5_000) });
  const banks = await paylov.gateway.listBanks({ signal: AbortSignal.timeout(10_000) });
  console.log(`paylov ok: ${banks.length} banks`);
} finally {
  await paylov.close();
}
```

## Runtime behavior

- **Deadlines.** `timeoutMs` bounds one HTTP attempt (`sdk_timeout`). A call's `{ signal }` bounds
  the whole call: attempts, backoff and the token wait (`sdk_aborted`, never retried). A GET can
  make `maxGetRetries` + 2 attempts (four by default, with the token replay), so pass a `signal` for
  a real deadline. A write that timed out, or was aborted while its request was in flight, has an
  unknown outcome ([errors.md](errors.md#recovery-after-an-ambiguous-failure)); an abort before
  anything was sent reports `isSent: false`.
- **Retries.** Only GETs retry a failure: `maxGetRetries` times (an integer from 0 to 5, default 2),
  after a network error, a timeout or HTTP 500/502/503/504, with a jittered backoff of up to 200 ms
  that doubles per retry. POST and DELETE never retry a failure, whatever `maxGetRetries` says; they
  are sent twice only by the token replay below. Nothing retries a 429: wait `retryAfterSeconds`, on
  a `PaylovApiError` or, when the body is unusable, a `PaylovProtocolError`. A 429's `Retry-After`
  header sets it, ahead of a delay in its body, only as delta-seconds from 1 to 3600. A caller abort
  while a 429 body is read is `sdk_aborted`.
- **Tokens.** Acquired lazily on the first authenticated call, shared by concurrent calls and
  refreshed before expiry. After an authenticated HTTP 401 `permission_denied` in Paylov's complete
  error envelope (`result: null` and a string `error.message`), which the gateway sends before it
  runs the request, the client drops that token and replays the call once, whatever its method, with
  a new token, or with the newer one a concurrent grant already supplied. A bare 401, or one with an
  incomplete envelope, is never replayed and leaves a write's outcome unknown. A refresh rejected
  with `invalid_grant` at HTTP 401 falls back to one password grant; no other refresh failure does.
- **Locked client.** Only an `invalid_grant` at HTTP 401 from the password grant locks the client:
  later calls rethrow it without I/O, because repeated failed logins can lock the merchant account.
  Fix the credentials or account, then construct a new client.
- **Token rate limit.** After any HTTP 429 from the token endpoint (about 10 grants per minute on
  the development gateway), whatever its body, calls rethrow it without I/O until
  `retryAfterSeconds` has passed, or 60 s when the 429 carries no usable delay. A 429 is never a
  credential verdict: it neither locks the client nor makes a rejected refresh fall back to the
  password.
- **Redirects** are not followed.
- **Logger.** `onRequest` and `onResponse` receive metadata for every attempt, token requests and
  the revocation in `close()` included; `onResponse` reports a response that broke the endpoint's
  contract with `sdk_malformed_response` or `sdk_unexpected_status`. Hooks are not awaited and their
  failures are discarded.
- **Clock.** `now` (default the system clock) drives token expiry and `holds.create`'s
  `clientCaptureDeadline`. Inject it in tests instead of mocking `Date`.
- **`fetch`.** Inject a `fetch` to route through a proxy or for tests ([testing.md](testing.md)).
  `PaylovOnboarding` takes the same `timeoutMs`, `maxGetRetries`, `fetch` and `logger`.
