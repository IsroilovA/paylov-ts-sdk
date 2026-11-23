# Webhooks

`PaylovWebhookReceiver` authenticates and decodes inbound webhooks without a `PaylovClient` or an
HTTP framework. Paylov configures the webhook URLs and their Basic credentials on request; no API
sets them.

| `kind`                | Meaning                                                       | Answer                  | Dedupe key      |
| --------------------- | ------------------------------------------------------------- | ----------------------- | --------------- |
| `transaction.check`   | Checkout: validate the order before payment                   | `createWebhookResponse` | —               |
| `transaction.perform` | Checkout: apply the payment, then answer `accept`             | `createWebhookResponse` | `transactionId` |
| `transaction.cancel`  | Cancelled in the Paylov business panel or by Paylov staff     | any 2xx                 | `transactionId` |
| `merchant.deposit`    | An A2C, Paynet or Munis deposit reached your merchant account | any 2xx                 | `depositId`     |
| `card.bind`           | A card was bound through a Card Bind link                     | any 2xx                 | `token`         |

## Receive

```ts
import {
  createWebhookResponse,
  PaylovWebhookReceiver,
  type WebhookInput,
  type WebhookResponseBody,
} from '@isroilov_an/paylov';

const receiver = new PaylovWebhookReceiver({
  credentials: [
    { login: webhookLoginFromSecretManager, password: webhookPasswordFromSecretManager },
  ],
});

export interface WebhookReply {
  readonly status: number;
  readonly body?: WebhookResponseBody;
}

const reply = (status: number, body?: WebhookResponseBody): WebhookReply => ({ status, body });

export async function handleWebhook(request: WebhookInput): Promise<WebhookReply> {
  const event = receiver.receive(request);
  switch (event.kind) {
    case 'transaction.check': {
      const order = await orders.findByAccount(event.account);
      if (order === undefined) return reply(200, createWebhookResponse(event, 'order_not_found'));
      if (!order.matches(event.amount)) {
        return reply(200, createWebhookResponse(event, 'invalid_amount'));
      }
      return reply(200, createWebhookResponse(event, 'accept'));
    }
    case 'transaction.perform':
      // Re-checks account and amount (currency included) before applying, once per transactionId.
      await orders.applyPaymentOnce(event.transactionId, event.account, event.amount);
      return reply(200, createWebhookResponse(event, 'accept'));
    case 'transaction.cancel':
      await orders.markCancelledOnce(event.transactionId, event.cancelledAt);
      return reply(200);
    case 'merchant.deposit':
      await ledger.recordDepositOnce(event.depositId, event.source, event.amountTiyin);
      return reply(200);
    case 'card.bind':
      // Never retried: store it before answering, confirm it with cards.get from a job (cards.md).
      await bindEvents.saveOnce(event.token, event.userId, event.cardId);
      return reply(200);
    case 'invalid':
      return reply(event.reason === 'unauthorized' ? 401 : 400);
  }
}
```

`orders`, `ledger` and `bindEvents` are application code. For perform, answer `accept` only after
the payment is applied; if applying fails, let the handler fail rather than answer `accept`.

Pass `body` already read: JSON text, bytes (`Uint8Array`, `Buffer` or `ArrayBuffer`), or the value a
JSON body parser produced. An unread stream, such as a Fetch `Request`'s `body`, or a `Blob` answers
`malformed_body`.

## Rotate credentials

List every pair Paylov may currently send, at least one; logins carry no `:`. During a rotation,
configure the old and the new pair, ask Paylov to switch, and remove the old pair once
`event.credentialIndex` (its position in the list) shows only the new one:

```ts
const rotating = new PaylovWebhookReceiver({
  credentials: [
    { login: oldWebhookLogin, password: oldWebhookPassword },
    { login: newWebhookLogin, password: newWebhookPassword },
  ],
});
```

Every pair is compared in constant time, so the response time does not reveal which one matched.
`credentialIndex` is for your metrics; never return it to the caller.

## Cap the body size

The request is unauthenticated until `receive()` runs: read at most a fixed number of bytes
(callbacks are small; 64 KiB is ample) and answer 413 beyond it, whatever `Content-Length` says.
With a framework, set that cap on the body parser that produces the raw body.

With a Fetch-style framework (a `Request`), read the raw bytes with that cap:

```ts
const MAX_BODY_BYTES = 64 * 1024;

async function readBody(request: Request): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) return undefined; // stops and cancels the upload
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function serveFetch(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (body === undefined) return new Response(null, { status: 413 });
  const answer = await handleWebhook({ method: request.method, headers: request.headers, body });
  return answer.body === undefined
    ? new Response(null, { status: answer.status })
    : Response.json(answer.body, { status: answer.status });
}
```

With plain `node:http`, do not return from a `for await` loop over the request: that destroys the
socket before the 413 is sent. Stop buffering instead, answer with `Connection: close`, and destroy
the request once the answer is written:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 64 * 1024;

function readBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const tooLarge = (): void => {
      res.writeHead(413, { connection: 'close' }).end(() => req.destroy());
      resolve(undefined);
    };
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) return tooLarge();
    req.on('data', (chunk: Buffer) => {
      if (size > MAX_BODY_BYTES) return; // already answered
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) return tooLarge();
      chunks.push(chunk);
    });
    req.on('end', () => resolve(size > MAX_BODY_BYTES ? undefined : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req, res);
  if (body === undefined) return;
  const answer = await handleWebhook({ method: req.method, headers: req.headers, body });
  if (answer.body === undefined) return void res.writeHead(answer.status).end();
  res.writeHead(answer.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(answer.body));
}

createServer((req, res) => {
  serveNode(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
  });
}).listen(webhookPort);
```

## Pitfalls

- **Check the currency.** The checkout link is unsigned, so a customer can change its currency: an
  amount that matches in the wrong currency is not a match.
- **Narrow `account` yourself.** It passes through as received; keep your own order mapping
  ([checkout.md](checkout.md#hosted-checkout-link)).
- **Persist `card.bind` before answering.** Paylov never retries it and it carries only `cardId`;
  confirm the card with `paylov.cards.get` from a job ([cards.md](cards.md#card-bind)).
- **Deduplicate** on the keys in the table: Paylov retries `transaction.cancel` and
  `merchant.deposit` up to 3 times at 60 s intervals after a non-2xx or no response. Paylov
  documents no retry of check and perform, and the SDK assumes none: a perform your handler did not
  answer with `accept` is not sent again.
- **Only `accept` completes a payment**, by the SDK's assumption: any other perform answer, an error
  response or no response leaves the payment uncompleted, so the order stays unpaid. Paylov
  documents only the `accept` answer; before treating an unpaid order as final, read
  `paylov.transactions.get({ transactionId })`.
- **Invalid input** has no documented response; choose the status yourself.
