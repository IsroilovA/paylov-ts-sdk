/** Authenticated webhook requests for testing a `PaylovWebhookReceiver` integration. */

import { decodeWebhook } from '../webhooks/decoders.js';
import { encodeWebhookEvent } from '../webhooks/fake.js';
import type { PaylovWebhookCredentials, WebhookEvent, WebhookInput } from '../webhooks/types.js';

/**
 * The request Paylov would send for `event`, authenticated with one of the receiver's credential
 * pairs, so `receiver.receive(request)` returns `event` with that pair's `credentialIndex`. Change
 * the result to cover the `invalid` outcomes. Throws `TypeError` for an event the receiver would
 * not decode, such as a `transactionId` that is not a UUID or an `amountTiyin` that is not a
 * non-negative safe integer, and for a time the wire cannot carry (sub-second or before 1970).
 *
 * @example
 * import { createWebhookRequest } from '@isroilov_an/paylov/testing';
 *
 * const request = createWebhookRequest(
 *   {
 *     kind: 'transaction.cancel',
 *     transactionId: '00000000-0000-4000-8000-000000000001',
 *     account: { order_id: '12345' },
 *     amountTiyin: 150_000,
 *     cancelledAt: new Date('2026-01-01T00:00:00Z'),
 *   },
 *   { login: webhookLogin, password: webhookPassword },
 * );
 * const response = await handleWebhook(request); // your handler around receiver.receive
 */
export function createWebhookRequest(
  event: WebhookEvent,
  credentials: PaylovWebhookCredentials,
): WebhookInput {
  const body = JSON.stringify(encodeWebhookEvent(event));
  const decoded = decodeWebhook(body);
  if (decoded.kind === 'invalid') {
    throw new TypeError(`the receiver would read this event as invalid (${decoded.reason})`);
  }
  const pair = `${credentials.login}:${credentials.password}`;
  const authorization = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
  return {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body,
  };
}
