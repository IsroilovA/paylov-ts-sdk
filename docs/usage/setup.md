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
  development gateway a revoked token keeps working. `close()` resolves even when revocation fails;
  only the logger events report that, and the token then stays valid until it expires.
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
  make up to four attempts, so pass a `signal` for a real deadline. A timed-out POST, or one aborted
  after it was sent, has an unknown outcome
  ([errors.md](errors.md#recovery-after-an-ambiguous-failure)); an abort before anything was sent
  reports `isSent: false`.
- **Retries.** Only GETs retry: at most twice, after a network error, a timeout or HTTP
  500/502/503/504. POST and DELETE never retry. Nothing retries a 429: wait `retryAfterSeconds`.
- **Tokens.** Acquired lazily on the first authenticated call, shared by concurrent calls and
  refreshed before expiry. After a 401 `permission_denied` the client fetches a new token and
  replays the call once.
- **Locked client.** An `invalid_grant` from the password grant locks the client: later calls
  rethrow it without I/O, because repeated failed logins can lock the merchant account. Fix the
  credentials or account, then construct a new client.
- **Token rate limit.** After an HTTP 429 from the token endpoint (about 10 grants per minute on the
  development gateway), calls rethrow it without I/O until `retryAfterSeconds` (60 s if none) has
  passed.
- **Redirects** are not followed.
- **Logger.** `onRequest` and `onResponse` receive metadata for every attempt, token requests
  included. Hooks are not awaited and their failures are discarded.
- **`fetch`.** Inject a `fetch` to route through a proxy or for tests ([testing.md](testing.md)).
  `PaylovOnboarding` takes the same `timeoutMs`, `fetch` and `logger`.
