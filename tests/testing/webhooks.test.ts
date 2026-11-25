import { describe, expect, it } from 'vitest';

import { createWebhookRequest } from '../../src/testing/webhooks.js';
import type { WebhookEvent } from '../../src/webhooks/types.js';
import { PaylovWebhookReceiver } from '../../src/webhooks/receiver.js';
import { capture } from '../helpers/asserts.js';

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

  it('rejects a time the wire cannot carry', () => {
    const cancel = { ...(EVENTS[0] as WebhookEvent), cancelledAt: new Date(1_500) };
    expect(capture(() => createWebhookRequest(cancel, CREDENTIALS))).toBeInstanceOf(TypeError);
  });
});
