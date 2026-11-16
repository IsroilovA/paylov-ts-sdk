/** Answers to `transaction.check` and `transaction.perform`. */

import { invalidInput } from '../core/errors.js';
import { everyLiteral, readParams, type Params } from '../core/params.js';
import { isCallbackId } from './decoders.js';
import type {
  TransactionCheckEvent,
  TransactionPerformEvent,
  WebhookCallbackId,
  WebhookDecision,
  WebhookResponseBody,
} from './types.js';

type WebhookResult = WebhookResponseBody['result'];
type DecisionWord = Exclude<WebhookDecision, object>;

const DECISIONS = everyLiteral<DecisionWord>()([
  'accept',
  'maintenance',
  'invalid_amount',
  'order_not_found',
]);

const RESULTS: Readonly<Record<DecisionWord, WebhookResult>> = {
  accept: { status: '0', statusText: 'OK' },
  maintenance: { status: '3', statusText: 'Maintenance' },
  invalid_amount: { status: '5', statusText: 'Invalid amount' },
  order_not_found: { status: '303', statusText: 'Order not found' },
};

const METHOD = 'createWebhookResponse';

/**
 * Builds the documented JSON-RPC answer to a `transaction.check` or `transaction.perform`
 * event, with the status {@link WebhookDecision} maps `decision` to. Send it as the JSON body of
 * an HTTP 200. Moves no money; for perform, answer `accept` only after the payment is applied to
 * the order.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_input` for an event that is not a check or
 * perform event with a JSON-RPC id, or an unknown decision or a blank custom text.
 *
 * @example
 * const order = await orders.find(event.account);
 * const decision = order === undefined ? 'order_not_found' : 'accept';
 * reply(200, createWebhookResponse(event, decision));
 */
export function createWebhookResponse(
  event: TransactionCheckEvent | TransactionPerformEvent,
  decision: WebhookDecision,
): WebhookResponseBody {
  const input = readParams({ event, decision }, METHOD);
  const id = input.object('event', readCallbackId);
  return { jsonrpc: '2.0', id, result: resultOf(input) };
}

function readCallbackId(event: Params): WebhookCallbackId {
  event.literal('kind', ['transaction.check', 'transaction.perform']);
  const id = event.raw('id');
  if (!isCallbackId(id)) {
    throw invalidInput(`${METHOD}: event.id must be a JSON-RPC id`, 'event.id', 'type');
  }
  return id;
}

function resultOf(input: Params): WebhookResult {
  if (typeof input.raw('decision') === 'object') {
    return {
      status: '+1',
      statusText: input.object('decision', (custom) => custom.string('custom')),
    };
  }
  return { ...RESULTS[input.literal('decision', DECISIONS)] };
}
