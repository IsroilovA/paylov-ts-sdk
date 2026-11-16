/** Authenticated webhook requests for testing a `PaylovWebhookReceiver` integration. */

import { encodeWebhookEvent } from '../webhooks/fake.js';
import type { PaylovWebhookReceiverConfig, WebhookEvent, WebhookInput } from '../webhooks/types.js';

/**
 * The request Paylov would send for `event`, authenticated with the receiver's credentials, so
 * `receiver.receive(request)` returns `event`. Change the result to cover the `invalid`
 * outcomes. Throws `TypeError` for a time the wire cannot carry (sub-second or before 1970).
 *
 * @example
 * import { createWebhookRequest } from '@isroilov_an/paylov/testing';
 *
 * const request = createWebhookRequest(
 *   {
 *     kind: 'transaction.check',
 *     id: 1,
 *     account: { order_id: 'A-1024' },
 *     amount: { currency: 860, amountTiyin: 50_000 },
 *   },
 *   { login: webhookLogin, password: webhookPassword },
 * );
 * const response = await handleWebhook(request); // your handler around receiver.receive
 */
export function createWebhookRequest(
  event: WebhookEvent,
  credentials: PaylovWebhookReceiverConfig,
): WebhookInput {
  const pair = `${credentials.login}:${credentials.password}`;
  const authorization = `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
  return {
    method: 'POST',
    headers: { authorization },
    body: JSON.stringify(encodeWebhookEvent(event)),
  };
}
