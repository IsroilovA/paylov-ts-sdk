# Testing

Two doubles, imported only from tests:

- A narrow interface you fake yourself, for business logic that only needs results.
- `PaylovFakeGateway` from `@isroilov_an/paylov/testing`, for code that meets SDK behavior: errors,
  `isPaylovOutcomeUnknown`, retries, timeouts, the token lifecycle and logger events.

## Stub the client

Depend on the namespaces your code uses, not on `PaylovClient`; a `PaylovClient` satisfies the
narrowed type:

```ts
import {
  PaylovApiError,
  type PaymentsResource,
  type TransactionsResource,
} from '@isroilov_an/paylov';

export interface PaylovPort {
  readonly payments: Pick<PaymentsResource, 'create' | 'pay'>;
  readonly transactions: Pick<TransactionsResource, 'get'>;
}

const fake: PaylovPort = {
  payments: {
    create: async () => ({ transactionId: '00000000-0000-4000-8000-000000000001' }),
    pay: async ({ transactionId }) => ({ transactionId }),
  },
  transactions: {
    get: async () => {
      throw new PaylovApiError({
        code: 'transaction_not_found',
        httpStatus: 200,
        endpoint: 'GET /merchant/getTransactions/',
      });
    },
  },
};
```

To test a failure branch, throw the SDK's own error, e.g.
`new PaylovApiError({ code: 'insufficient_funds', httpStatus: 400, endpoint: 'POST /merchant/receipts/pay/' })`.

## Script the fake gateway

```ts
import { PaylovClient, isPaylovOutcomeUnknown } from '@isroilov_an/paylov';
import { PaylovFakeGateway } from '@isroilov_an/paylov/testing';

const fake = new PaylovFakeGateway();
const paylov = new PaylovClient({ ...fake.clientConfig, timeoutMs: 100 });

fake.payments.create.reply({ transactionId: '00000000-0000-4000-8000-000000000001' });
fake.payments.pay.disconnect();

const error = await payOrder(paylov, order).catch((caught: unknown) => caught);
expect(isPaylovOutcomeUnknown(error)).toBe(true);
fake.assertDone();
```

- Each SDK method has a script with `reply`, `fail`, `disconnect` and `hang`. Scripting a value or a
  failure the gateway cannot send throws `TypeError`.
- A lookup miss is a failure: `fake.holds.get.fail('transaction_not_found')`.
  `fake.onboarding.checkToken.reply(false)` sends the gateway's `invalid_or_expired` answer.
- A status outside the SDK's vocabulary passes through; a raw gateway spelling the SDK renames, such
  as a hold's `'paid'`, throws `TypeError`.
- An unscripted request fails with `fake_unscripted`, and a request the fake cannot read back into
  its method's params with `fake_unreadable_request`, both HTTP 501; `assertDone()` reports each.
- `hang()` ends the call with `sdk_timeout` after `timeoutMs`, or `sdk_aborted` when its signal
  aborts.
- `PaylovOnboarding` takes `fake.onboardingConfig` and is scripted through `fake.onboarding`.

### Sent params

Each script's `requests` lists the params of every attempt it served, decoded back from the wire
into the method's own params type (whole SUM back to tiyin, wire names back to SDK names):

```ts
fake.holds.capture.reply({ transactionId, cardId, capturedAt: new Date('2026-01-02T03:04:05Z') });
await captureOrder(paylov, order);
expect(fake.holds.capture.requests).toEqual([{ transactionId, amountTiyin: 150_000 }]);
```

A retried GET appears once per attempt. PAN methods record the card number you passed; passwords are
never recorded.

### One answer per attempt

- Each scripted answer serves one HTTP attempt. Retries follow
  [setup.md](setup.md#runtime-behavior): a GET that meets `disconnect()`, `hang()` or HTTP
  500/502/503/504 is retried up to `maxGetRetries` times (default 2), each retry taking the next
  answer. Script one answer per attempt, or pass `{ persist: true }` for a gateway that stays down:
  `fake.transactions.get.fail('server_error', { httpStatus: 500 }, { persist: true })`.
- `fail('permission_denied', { httpStatus: 401 })` makes the client fetch a new token and replay the
  call once against the next answer.
- Use fake timers to skip backoff waits.
- `assertDone()` flags an unscripted request that followed a retryable answer as a likely retry.

## Token endpoint

Token requests succeed with canary tokens unless `fake.token` scripts a failure. `grant` picks the
password grant or the refresh; `fake.token.requests` lists the grant of each token request:

```ts
fake.token.fail('invalid_grant', { grant: 'refresh_token' }); // falls back to one password grant
fake.token.fail('invalid_grant', { grant: 'password' }); // locks the client
fake.token.fail('rate_limit_exceeded', { retryAfterSeconds: 48 }); // HTTP 429 with Retry-After
```

`invalid_grant` and `invalid_client` default to HTTP 401, `rate_limit_exceeded` to 429, other codes
to 400. An unserved token answer fails `assertDone()`.

## Simulate gateway state

`new PaylovFakeGateway({ simulate: true })` keeps cards, payments, transactions and holds in memory
and answers unscripted calls from that state, so a test can run a whole flow:

```ts
let now = new Date('2026-11-12T10:00:00Z');
const fake = new PaylovFakeGateway({ simulate: true, now: () => now });
const paylov = new PaylovClient(fake.clientConfig); // hold deadlines use the same clock
fake.addCard(card); // a card as `cards.get` returns it, already bound

const hold = await paylov.holds.create({ ...holdParams, cardId: card.cardId, durationMinutes: 30 });
now = new Date(now.getTime() + 31 * 60_000);
await expect(
  paylov.holds.capture({ transactionId: hold.transactionId, amountTiyin }),
).rejects.toThrow();
// The capture failed with hold_time_expired; the hold now reads released.
fake.assertDone();
```

- It covers `cards.get`, `cards.list`, `cards.delete`, `payments.create`, `payments.pay`,
  `payments.refund`, `transactions.get`, `transactions.list` (and so `iterate`) and the four hold
  methods. Others still need a script.
- It reproduces only what Paylov's test environment has shown: one capture per hold, a partial
  capture ends the hold, an expired hold still reads `held`, capture after expiry fails with
  `hold_time_expired` and releases the hold, an `externalId` is never reused, a second pay answers
  `transaction_already_payed`, a second refund `transaction_not_available_for_cancel`, and the list
  shows paid sales only, by Tashkent day.
- A state it does not simulate, such as refunding a captured hold or a hold with a `serviceId`,
  answers `fake_unsimulated` (HTTP 501) and fails `assertDone()`: script that call instead.
- A scripted answer takes precedence over the simulation for the call it matches and does not change
  the stored state. Use it for declines and transient failures. A scripted `holds.create` decline
  stores no record, unlike Paylov, which keeps a `declined` hold and its used-up `externalId`:
  script the `holds.get` and `transactions.get` that follow too.
- Generated ids are `00000000-0000-4000-a000-…`; times are whole seconds from `now`. An id that only
  a scripted reply returned is unknown to the simulation.

## Logger events

Assert attempts through the logger instead of counting requests. Hooks are not awaited: assert after
the call settles.

```ts
import type { PaylovLoggerResponseEvent } from '@isroilov_an/paylov';

const events: PaylovLoggerResponseEvent[] = [];
const paylov = new PaylovClient({
  ...fake.clientConfig,
  logger: { onResponse: (event) => void events.push(event) },
});
```

## Webhook requests

`createWebhookRequest(event, credentials)` builds the request Paylov would send, so
`receiver.receive(request)` returns that event with the matching `credentialIndex`:

```ts
import { PaylovWebhookReceiver } from '@isroilov_an/paylov';
import { createWebhookRequest } from '@isroilov_an/paylov/testing';

const credentials = { login: 'EXAMPLE-WEBHOOK-LOGIN', password: 'EXAMPLE-WEBHOOK-PASSWORD' };
const receiver = new PaylovWebhookReceiver({ credentials: [credentials] });

const request = createWebhookRequest(
  {
    kind: 'transaction.cancel',
    transactionId: '00000000-0000-4000-8000-0000000000b1',
    account: { order_id: 'A-1024' },
    amountTiyin: 50_000,
    cancelledAt: new Date('2026-01-02T03:04:05Z'),
  },
  credentials,
);
```

Change the request's header, method or body to cover the `invalid` outcomes.

## Fixtures

Fixtures never hold real tokens, card numbers, OTPs, PINFLs, phone numbers or card expiries. The SDK
does not check card number values, so pass a placeholder such as `'PAN-FROM-SECURE-INPUT'`.
