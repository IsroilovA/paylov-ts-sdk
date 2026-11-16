/** Inbound Paylov webhook authentication. */

import { hash, timingSafeEqual } from 'node:crypto';

import { configError } from '../core/errors.js';
import { isRecord } from '../core/decoding.js';
import { readConfig } from '../core/params.js';
import { decodeWebhook, invalid } from './decoders.js';
import type { PaylovWebhookReceiverConfig, WebhookInput, WebhookOutcome } from './types.js';

function sha256(value: string): Buffer {
  return hash('sha256', value, 'buffer');
}

/** The single Authorization header value; a repeated header is never a single value. */
function readAuthorization(headers: unknown): unknown {
  if (headers instanceof Headers) return headers.get('authorization');
  if (!isRecord(headers)) return undefined;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'authorization');
  const value = key === undefined ? undefined : headers[key];
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function decodeBasicCredentials(header: unknown): readonly [string, string] | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^Basic[\t ]+([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  const token = match?.[1];
  if (token === undefined || token.length % 4 !== 0) return undefined;

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(token, 'base64'));
  } catch {
    return undefined;
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) return undefined;
  return [decoded.slice(0, separator), decoded.slice(separator + 1)];
}

/**
 * Authenticates and decodes Paylov webhooks: checkout `transaction.check` and
 * `transaction.perform`, the `transaction.cancel` and `merchant.deposit` notifications, and the
 * Card Bind notification. Moves no money and keeps no state.
 *
 * `receive` never throws for anything a request carries. It checks `POST` and HTTP Basic
 * credentials in constant time, then returns a decoded event or `{ kind: 'invalid', reason }`.
 * The caller owns everything after:
 * - answer check and perform with HTTP 200 and `createWebhookResponse(event, decision)`;
 * - acknowledge `transaction.cancel`, `merchant.deposit` and `card.bind` with any 2xx once
 *   handled;
 * - deduplicate: `transaction.perform` and `transaction.cancel` on `transactionId`,
 *   `merchant.deposit` on `depositId`, `card.bind` on `token`. Paylov retries cancel and deposit
 *   up to 3 times at 60 s intervals. It documents no retry of check and perform, and the SDK
 *   assumes none and that only an `accept` answer to perform completes the payment;
 * - choose the HTTP response for invalid input; Paylov documents none.
 *
 * @example
 * const receiver = new PaylovWebhookReceiver({
 *   login: webhookLoginFromSecretManager,
 *   password: webhookPasswordFromSecretManager,
 * });
 * const event = receiver.receive({ method: req.method, headers: req.headers, body: rawBody });
 * switch (event.kind) {
 *   case 'transaction.check':
 *     return reply(200, createWebhookResponse(event, await decideCheck(event)));
 *   case 'merchant.deposit':
 *     await recordDepositOnce(event.depositId, event.amountTiyin);
 *     return reply(200);
 *   case 'invalid':
 *     return reply(event.reason === 'unauthorized' ? 401 : 400);
 * }
 *
 * @throws {@link PaylovInputError} `sdk_config_error` for a missing login or password, or a login
 * containing a colon.
 */
export class PaylovWebhookReceiver {
  readonly #loginHash: Buffer;
  readonly #passwordHash: Buffer;

  constructor(config: PaylovWebhookReceiverConfig) {
    const surface = 'PaylovWebhookReceiver config';
    const params = readConfig(config, surface);
    const login = params.string('login');
    // RFC 7617 splits credentials at the first colon, so such a login could never authenticate.
    if (login.includes(':')) {
      throw configError(`${surface}: login must not contain a colon`, 'login', 'format');
    }
    this.#loginHash = sha256(login);
    this.#passwordHash = sha256(params.string('password'));
  }

  /**
   * Authenticates and decodes one inbound webhook. Never throws for anything the request
   * carries. Pass the body already read, as text, bytes or parsed JSON: an unread stream such as
   * a Fetch `Request`'s `body` is answered `malformed_body`.
   *
   * @example
   * const event = receiver.receive({
   *   method: request.method,
   *   headers: request.headers,
   *   body: new Uint8Array(await request.arrayBuffer()),
   * });
   * if (event.kind === 'transaction.cancel') await markCancelledOnce(event.transactionId);
   */
  receive(input: WebhookInput): WebhookOutcome {
    if (!isRecord(input)) return invalid('invalid_request');
    if (input.method !== 'POST') return invalid('unsupported_http_method');
    if (!this.#isAuthorized(input.headers)) return invalid('unauthorized');
    return decodeWebhook(input.body);
  }

  #isAuthorized(headers: unknown): boolean {
    const credentials = decodeBasicCredentials(readAuthorization(headers));
    if (credentials === undefined) return false;
    // Compare both digests before combining, so a login mismatch costs the same time.
    const loginMatches = timingSafeEqual(sha256(credentials[0]), this.#loginHash);
    const passwordMatches = timingSafeEqual(sha256(credentials[1]), this.#passwordHash);
    return loginMatches && passwordMatches;
  }
}
