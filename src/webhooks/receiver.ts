/** Inbound Paylov webhook authentication. */

import { hash, timingSafeEqual } from 'node:crypto';

import { configError } from '../core/errors.js';
import { isRecord } from '../core/decoding.js';
import { readConfig, type Params } from '../core/params.js';
import { decodeWebhook, invalid } from './decoders.js';
import type { PaylovWebhookReceiverConfig, WebhookInput, WebhookOutcome } from './types.js';

function sha256(value: string): Buffer {
  return hash('sha256', value, 'buffer');
}

interface CredentialDigests {
  readonly login: Buffer;
  readonly password: Buffer;
}

function readCredentialDigests(pair: Params, index: number): CredentialDigests {
  const login = pair.string('login');
  // RFC 7617 splits credentials at the first colon, so such a login could never authenticate.
  if (login.includes(':')) {
    const field = `credentials[${index}].login`;
    throw configError(
      `PaylovWebhookReceiver config: ${field} must not contain a colon`,
      field,
      'format',
    );
  }
  return { login: sha256(login), password: sha256(pair.string('password')) };
}

/**
 * The single Authorization header value. A repeated header, or several keys that differ only in
 * case, is never a single value.
 */
function readAuthorization(headers: unknown): unknown {
  if (headers instanceof Headers) return headers.get('authorization');
  if (!isRecord(headers)) return undefined;
  const [key, ...duplicates] = Object.keys(headers).filter(
    (name) => name.toLowerCase() === 'authorization',
  );
  const value = key === undefined || duplicates.length > 0 ? undefined : headers[key];
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
 * Authenticates and decodes Paylov webhooks: the `transaction.cancel` notification. Moves no
 * money and keeps no state.
 *
 * `receive` never throws for anything a request carries. It checks `POST` and HTTP Basic
 * credentials against every configured pair in constant time, then returns a decoded event with
 * the `credentialIndex` of the pair that matched, or `{ kind: 'invalid', reason }`. List several
 * pairs to rotate credentials without downtime.
 * The caller owns everything after:
 * - acknowledge each event with any 2xx once handled;
 * - deduplicate on `transactionId`: Paylov retries up to 3 times at 60 s intervals;
 * - choose the HTTP response for invalid input; Paylov documents none.
 *
 * @example
 * const receiver = new PaylovWebhookReceiver({
 *   credentials: [{ login: webhookLoginFromSecretManager, password: webhookPasswordFromSecretManager }],
 * });
 * // Node `http`: `headersDistinct` keeps a repeated Authorization header, `headers` drops it.
 * const event = receiver.receive({ method: req.method, headers: req.headersDistinct, body: rawBody });
 * switch (event.kind) {
 *   case 'transaction.cancel':
 *     await markCancelledOnce(event.transactionId);
 *     return reply(200);
 *   case 'invalid':
 *     return reply(event.reason === 'unauthorized' ? 401 : 400);
 * }
 *
 * @throws {@link PaylovInputError} `sdk_config_error` for an empty `credentials` list, a missing
 * login or password, or a login containing a colon.
 */
export class PaylovWebhookReceiver {
  readonly #credentials: readonly CredentialDigests[];

  constructor(config: PaylovWebhookReceiverConfig) {
    const surface = 'PaylovWebhookReceiver config';
    const params = readConfig(config, surface);
    this.#credentials = params.array('credentials', readCredentialDigests);
    if (this.#credentials.length === 0) {
      throw configError(
        `${surface}: credentials must list at least one pair`,
        'credentials',
        'required',
      );
    }
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
    const credentialIndex = this.#matchingCredential(input.headers);
    if (credentialIndex === undefined) return invalid('unauthorized');
    const decoded = decodeWebhook(input.body);
    return decoded.kind === 'invalid' ? decoded : { ...decoded, credentialIndex };
  }

  /**
   * Compares the request against every pair, both digests each, before choosing: the time taken
   * does not depend on which pair matched or which half differed.
   */
  #matchingCredential(headers: unknown): number | undefined {
    const credentials = decodeBasicCredentials(readAuthorization(headers));
    if (credentials === undefined) return undefined;
    const login = sha256(credentials[0]);
    const password = sha256(credentials[1]);
    const matches = this.#credentials.map(
      (pair) =>
        Number(timingSafeEqual(login, pair.login)) &
        Number(timingSafeEqual(password, pair.password)),
    );
    const index = matches.indexOf(1);
    return index < 0 ? undefined : index;
  }
}
