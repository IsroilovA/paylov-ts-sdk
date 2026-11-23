/** Compile-time contracts for inbound webhooks and callback answers. */

import type { IncomingMessage } from 'node:http';

import {
  createWebhookResponse,
  PaylovWebhookReceiver,
  type WebhookOutcome,
  type WebhookResponseBody,
} from '../../src/index.js';

const receiver = new PaylovWebhookReceiver({
  credentials: [
    {
      login: 'EXAMPLE-CALLBACK-LOGIN',
      password: 'EXAMPLE-CALLBACK-PASSWORD-NOT-A-REAL-CREDENTIAL',
    },
  ],
});
// @ts-expect-error at least one credential pair
void new PaylovWebhookReceiver({ credentials: [] });
// @ts-expect-error a single pair goes in the credentials list
void new PaylovWebhookReceiver({ login: 'EXAMPLE-CALLBACK-LOGIN', password: 'x' });
const outcome: WebhookOutcome = receiver.receive({ method: 'POST', headers: {}, body: {} });
if (outcome.kind !== 'invalid') {
  const credentialIndex: number = outcome.credentialIndex;
  void credentialIndex;
}

declare const nodeRequest: IncomingMessage;
void receiver.receive({ method: nodeRequest.method, headers: nodeRequest.headers, body: '' });
declare const fetchRequest: Request;
void receiver.receive({ method: fetchRequest.method, headers: fetchRequest.headers, body: '' });
// @ts-expect-error the body is required, even when empty
void receiver.receive({ method: 'POST', headers: {} });
void receiver.receive({ method: 'POST', headers: {}, body: new Uint8Array() });
void receiver.receive({ method: 'POST', headers: {}, body: new ArrayBuffer(0) });
void receiver.receive({ method: 'POST', headers: {}, body: { jsonrpc: '2.0', params: [1, null] } });
// @ts-expect-error an unread Fetch body stream cannot be decoded
void receiver.receive({ method: 'POST', headers: {}, body: fetchRequest.body });
// @ts-expect-error read a Blob first
void receiver.receive({ method: 'POST', headers: {}, body: new Blob([]) });

switch (outcome.kind) {
  case 'transaction.check': {
    const minor =
      outcome.amount.currency === 860 ? outcome.amount.amountTiyin : outcome.amount.amountCents;
    void minor;
    const answer: WebhookResponseBody = createWebhookResponse(outcome, 'accept');
    void answer;
    void createWebhookResponse(outcome, { custom: 'monthly_limit_exceeded' });
    // @ts-expect-error decisions are semantic, not wire statuses
    void createWebhookResponse(outcome, '0');
    // @ts-expect-error the whole-currency amount is not exposed
    void outcome.amountTiyin;
    break;
  }
  case 'transaction.perform':
    void (outcome.transactionId, outcome.amount);
    void createWebhookResponse(outcome, 'order_not_found');
    break;
  case 'transaction.cancel': {
    const cancelledAt: Date = outcome.cancelledAt;
    void [outcome.transactionId, outcome.amountTiyin, cancelledAt];
    // @ts-expect-error notifications carry no JSON-RPC id to answer
    void createWebhookResponse(outcome, 'accept');
    break;
  }
  case 'merchant.deposit': {
    const createdAt: Date = outcome.createdAt;
    const source: string = outcome.source;
    void [outcome.depositId, outcome.merchantId, outcome.amountTiyin, createdAt, source];
    // @ts-expect-error notifications carry no JSON-RPC id to answer
    void createWebhookResponse(outcome, 'accept');
    break;
  }
  case 'card.bind': {
    const cardId: string = outcome.cardId;
    void [outcome.token, outcome.userId, outcome.status, cardId];
    // @ts-expect-error the card-bind event surfaces only the card id
    void outcome.card;
    break;
  }
  case 'invalid':
    void outcome.reason;
    break;
  default: {
    const exhaustive: never = outcome;
    void exhaustive;
  }
}
