import { describe, expect, it } from 'vitest';

import { createWebhookRequest } from '../../src/testing/webhooks.js';
import type { WebhookEvent, WebhookInput } from '../../src/webhooks/types.js';
import { PaylovWebhookReceiver } from '../../src/webhooks/receiver.js';
import { capture } from '../helpers/asserts.js';
import { loadFixture } from '../helpers/fixtures.js';

const CREDENTIALS = { login: 'EXAMPLE-WEBHOOK-LOGIN', password: 'EXAMPLE-WEBHOOK-PASSWORD' };
const TRANSACTION_ID = '00000000-0000-4000-8000-0000000000b1';
const ACCOUNT = { order_id: 'A-1024' };
const AT = new Date('2026-01-02T03:04:05Z');

const EVENTS: readonly WebhookEvent[] = [
  {
    kind: 'transaction.cancel',
    transactionId: TRANSACTION_ID,
    account: ACCOUNT,
    amountTiyin: 50_000,
    cancelledAt: AT,
  },
];

function bodyOf(request: WebhookInput): unknown {
  if (typeof request.body !== 'string') throw new TypeError('expected a JSON text body');
  return JSON.parse(request.body);
}

describe('createWebhookRequest', () => {
  const receiver = new PaylovWebhookReceiver({ credentials: [CREDENTIALS] });

  it.each(EVENTS.map((event) => [event.kind, event] as const))(
    'builds a %s request the receiver decodes back to the event',
    (_kind, event) => {
      expect(receiver.receive(createWebhookRequest(event, CREDENTIALS))).toEqual({
        ...event,
        credentialIndex: 0,
      });
    },
  );

  it('authenticates with the given credentials only', () => {
    const request = createWebhookRequest(EVENTS[0] as WebhookEvent, {
      ...CREDENTIALS,
      password: 'other',
    });
    expect(receiver.receive(request)).toEqual({ kind: 'invalid', reason: 'unauthorized' });
  });

  it('sends the documented notification: its headers and every params field', () => {
    const request = createWebhookRequest(
      {
        kind: 'transaction.cancel',
        transactionId: '9b3bd7be-9327-4608-b886-4353e49df05f',
        account: { order_id: '12345' },
        amountTiyin: 150_000,
        cancelledAt: new Date(1_767_162_243_000),
      },
      CREDENTIALS,
    );
    expect(request.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(bodyOf(request)).toEqual(
      loadFixture('webhooks/transactionCancel.notification.docs.json'),
    );
  });

  it('sends only the whole SUM part as amount', () => {
    const request = createWebhookRequest(
      { ...(EVENTS[0] as WebhookEvent), amountTiyin: 150_099 },
      CREDENTIALS,
    );
    expect(bodyOf(request)).toMatchObject({
      params: { amount: 1500, amount_in_tiyin: 150_099 },
    });
  });

  it.each([
    ['a transactionId that is not a UUID', { transactionId: 'not-a-uuid' }],
    ['a fractional amountTiyin', { amountTiyin: 1.5 }],
  ])('rejects an event with %s, which the receiver would not decode', (_case, change) => {
    const event = { ...(EVENTS[0] as WebhookEvent), ...change };
    expect(capture(() => createWebhookRequest(event, CREDENTIALS))).toBeInstanceOf(TypeError);
  });

  it('rejects a time the wire cannot carry', () => {
    const cancel = { ...(EVENTS[0] as WebhookEvent), cancelledAt: new Date(1_500) };
    expect(capture(() => createWebhookRequest(cancel, CREDENTIALS))).toBeInstanceOf(TypeError);
  });
});
