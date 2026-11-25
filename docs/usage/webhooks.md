# Webhooks

`PaylovWebhookReceiver` authenticates and decodes the inbound `transaction.cancel` webhook without a
`PaylovClient` or an HTTP framework. Paylov configures the webhook URL and its Basic credentials on
request; no API sets them. Paylov sends it when a transaction is cancelled in the Paylov business
panel or by Paylov staff.

Acknowledge each event with any 2xx once handled; Paylov ignores the body.

## Receive

```ts
import { PaylovWebhookReceiver, type WebhookInput } from '@isroilov_an/paylov';

const receiver = new PaylovWebhookReceiver({
  credentials: [
    { login: webhookLoginFromSecretManager, password: webhookPasswordFromSecretManager },
  ],
});

/** Resolves to the HTTP status to answer with; Paylov reads no response body. */
export async function handleWebhook(request: WebhookInput): Promise<number> {
  const event = receiver.receive(request);
  switch (event.kind) {
    case 'transaction.cancel':
      await orders.markCancelledOnce(event.transactionId, event.cancelledAt);
      return 200;
    case 'invalid':
      return event.reason === 'unauthorized' ? 401 : 400;
  }
}
```

`orders` is application code. If handling fails, let the handler fail rather than answer 2xx.

Pass `body` already read: JSON text, bytes (`Uint8Array`, `Buffer` or `ArrayBuffer`), or the value a
JSON body parser produced. An unread stream, such as a Fetch `Request`'s `body`, or a `Blob` answers
`malformed_body`.

## Rotate credentials

List every pair Paylov may currently send, at least one; logins carry no `:`. During a rotation,
configure the old and the new pair, ask Paylov to switch, and remove the old pair once
`event.credentialIndex` (its position in the list) shows only the new one:

```ts
import { PaylovWebhookReceiver } from '@isroilov_an/paylov';

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
  const status = await handleWebhook({ method: request.method, headers: request.headers, body });
  return new Response(null, { status });
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
  const status = await handleWebhook({ method: req.method, headers: req.headersDistinct, body });
  res.writeHead(status).end();
}

createServer((req, res) => {
  serveNode(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
  });
}).listen(webhookPort);
```

## Pitfalls

- **Narrow `account` yourself.** It passes through as received.
- **Deduplicate** on `transactionId`: Paylov retries up to 3 times at 60 s intervals after a non-2xx
  or no response.
- **Invalid input** has no documented response; choose the status yourself.
- **Only the documented notification decodes.** Any other method, such as a hosted checkout
  `transaction.check` or `transaction.perform` request, is `unknown_method`; a `transaction.cancel`
  with a JSON-RPC `id` is `invalid_request`, and one whose `params.status` is not `cancelled` is
  `invalid_params`. The amount comes from `amount_in_tiyin`; the whole-SUM `amount` is ignored.
- **Duplicate `Authorization` headers** are `unauthorized`, also as header-record keys that differ
  only in case. With `node:http`, pass `req.headersDistinct`: `req.headers` keeps only the first
  `Authorization` value, so a repeat goes unseen.
