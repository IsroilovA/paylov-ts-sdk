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
Pass `isOutcomeUnknown: true` to test the reconciliation branch; it defaults to `false`.

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

- Each SDK method has a script with `reply`, `fail`, `disconnect` and `hang`. Each scripts one HTTP
  attempt, not the call's result: the SDK's retries, token replay and decoding decide that, so
  `fake.onboarding.checkToken.fail('invalid_or_expired')` resolves `false`, and a GET that meets
  `disconnect()` succeeds on its next scripted answer.
- `reply` sends the wire shape the SDK decodes back into the scripted value, without the diagnostic
  fields the SDK discards. Scripting what the wire cannot carry throws `TypeError`: a fractional
  SUM, a sub-second time, a raw status spelling, a bank id that is not plain decimal digits, or
  failure details the gateway cannot report for the code. A value the SDK's own decoder refuses,
  such as an unmasked card number, passes the script and fails the call with
  `sdk_malformed_response`.
- A lookup miss is a failure: `fake.holds.get.fail('transaction_not_found')`.
  `fake.transactions.get.fail('transaction_not_found')` answers as Paylov does, with an empty list
  at HTTP 200 that the SDK reads as the miss: the error has `httpStatus` 200 and takes no failure
  details. `fake.onboarding.checkToken.reply(false)` sends the gateway's `invalid_or_expired`
  answer.
- A status outside the SDK's vocabulary passes through; a raw gateway spelling the SDK renames, such
  as a hold's `'paid'`, throws `TypeError`.
- An unscripted request fails with `fake_unscripted`, and a request the fake cannot read back into
  its method's params with `fake_unreadable_request`, both HTTP 501; `assertDone()` names each by
  its route template, such as `GET /merchant/userCard/getCard/{cardId}/`, and names an unserved
  answer or an unsimulated state by its method, such as `holds.get`.
- `hang()` leaves one attempt unanswered until `timeoutMs` ends it with `sdk_timeout`, after which a
  GET is retried; an abort of the call's signal ends the call with `sdk_aborted`.
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
import { PaylovClient } from '@isroilov_an/paylov';
import { PaylovFakeGateway } from '@isroilov_an/paylov/testing';

let now = new Date('2026-11-12T10:00:00Z');
const fake = new PaylovFakeGateway({ simulate: true, now: () => now, refundWindowMinutes: 60 });
const paylov = new PaylovClient(fake.clientConfig); // hold deadlines use the same clock
// A card as `cards.get` returns it, already bound; pays and holds may take 100 000 SUM in total.
fake.addCard(card, { spendableTiyin: 10_000_000 });

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
- It reproduces only what Paylov's test environment and documentation show: one capture per hold, a
  partial capture ends the hold and charges only the captured amount, a dismiss before expiry makes
  the held funds available to the card again, an expired hold still reads `held`, capture after
  expiry fails with `hold_time_expired` and releases the hold, an `externalId` is never reused, a
  second pay answers `transaction_already_payed`, a second refund or a refund of an unpaid payment
  `transaction_not_available_for_cancel`, a payment of zero `field_not_valid` on `amount`, a
  transaction id that is not a UUID `validation_error` on `transactionId` (read, pay and refund), an
  unknown transaction reads as the HTTP 200 miss, and the list shows paid rows only, newest first,
  by Tashkent day. A dismissed hold's transaction reads `cancel` on the wire, one released by a
  failed expired capture `refunded`; both decode as `refunded`.
- Two answers are the test's to choose, as Paylov's do not follow from what it reports. `addCard`'s
  `spendableTiyin` is what pays and holds may take from that card in total: Paylov documents no link
  between a reported `balanceTiyin` and an approval, so the balance never decides one.
  `refundWindowMinutes` is how long after a payment a refund succeeds; a later one answers
  `transaction_not_available_for_cancel` and the payment stays paid, as Paylov answers once its
  per-merchant cut-off passed.
- A deleted card stays deleted: `addCard` with its id throws `TypeError`, so bind a new card with a
  fresh `cardId`. Its open holds still capture in full and release before they expire, as in
  Paylov's test environment; new pays and holds with it answer `card_not_found`.
- A state it does not simulate answers `fake_unsimulated` (HTTP 501) and fails `assertDone()`:
  script that call instead.
- Paylov has a known answer, which the fake leaves to a script, for:
  - a hold below 10 SUM, outside 1 to 40 320 minutes, or with an `externalId` over 64 characters,
    and a capture below 10 SUM (`validation_error` or `field_not_valid`);
  - a refund of a captured hold (`processing_error` on Paylov's test environment).
- Paylov's behavior is unknown, so script what your case assumes, for:
  - a pay or hold on a card added without `spendableTiyin` or past it, and every refund without
    `refundWindowMinutes`;
  - a pay or hold that fits only once funds Paylov returns on its own schedule reach the card: a
    refund, the uncaptured rest of a partial capture, or a hold released after it expired, by a
    dismiss or by `hold_time_expired`;
  - a payment above 10 000 000 000 SUM, and a hold above 1 000 000 000 SUM, where Paylov answers
    `invalid_amount` from a bound it does not state;
  - a hold with another user's card, a pay or hold with an inactive card, a pay by another user than
    the payment was created for, and a hold with a `serviceId`;
  - a partial capture after the card was deleted, and a capture or release of an expired hold after
    the card was deleted; a capture both expired and above the held amount; a capture after a hold
    released after it expired; a second capture after `hold_time_expired`;
  - a release of an unknown or non-hold transaction, `holds.get` of a sale, a `payments.pay` of a
    hold, and a `payments.refund` of a hold that is not captured;
  - a transaction id in another UUID spelling, and a capture or `holds.get` by an id that is not a
    UUID;
  - `cards.get` or `cards.list` of a card the simulation charged, held or deleted, also after a
    release or refund, whose balance or cached read it cannot report;
  - a `transactions.list` with a day the calendar lacks, a `fromDate` after its `toDate`, or two
    rows paid in the same second, whose order is unobserved.
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
import { PaylovClient, type PaylovLoggerResponseEvent } from '@isroilov_an/paylov';

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

const credentials = {
  login: 'EXAMPLE-WEBHOOK-LOGIN',
  password: 'EXAMPLE-WEBHOOK-PASSWORD',
};
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

It sends the documented headers and body, `params.amount` in whole SUM included. An event the
receiver would not decode, such as a `transactionId` that is not a UUID, throws `TypeError`. Change
the request's header, method or body to cover the `invalid` outcomes.

## Fixtures

Fixtures never hold real tokens, card numbers, OTPs, PINFLs, phone numbers or card expiries. The SDK
does not check card number values, so pass a placeholder such as `'PAN-FROM-SECURE-INPUT'`.
