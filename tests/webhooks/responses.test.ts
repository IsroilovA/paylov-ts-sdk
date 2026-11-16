import { describe, expect, it } from 'vitest';

import type { PaylovInputRule } from '../../src/core/errors.js';
import { createWebhookResponse } from '../../src/webhooks/responses.js';
import type {
  WebhookDecision,
  TransactionCheckEvent,
  TransactionPerformEvent,
} from '../../src/webhooks/types.js';
import { expectInputError } from '../helpers/asserts.js';
import { loadFixture } from '../helpers/fixtures.js';

// Expectations come from docs/paylov/callbacks.md (statuses) and the documented answer bodies.
const CHECK_OK = loadFixture('webhooks/transactionCheck.responseOk.docs.json');
const CHECK_CUSTOM = loadFixture('webhooks/transactionCheck.responseCustom.docs.json');
const PERFORM_OK = loadFixture('webhooks/transactionPerform.responseOk.docs.json');

const CHECK: TransactionCheckEvent = {
  kind: 'transaction.check',
  id: 1234567,
  account: { order_id: 12 },
  amount: { currency: 860, amountTiyin: 50000 },
};
const PERFORM: TransactionPerformEvent = {
  kind: 'transaction.perform',
  id: 1234567,
  transactionId: '9bd1a92b-5cce-47c8-a2df-99a20836ab9e',
  account: { order_id: 12 },
  amount: { currency: 860, amountTiyin: 50000 },
};

describe('createWebhookResponse', () => {
  it('matches the documented check, perform and custom answers', () => {
    expect(createWebhookResponse(CHECK, 'accept')).toEqual(CHECK_OK);
    expect(createWebhookResponse(PERFORM, 'accept')).toEqual(PERFORM_OK);
    expect(createWebhookResponse(CHECK, { custom: 'monthly_limit_exceeded' })).toEqual(
      CHECK_CUSTOM,
    );
  });

  it('maps each semantic decision to its documented status', () => {
    const cases: readonly [WebhookDecision, string, string][] = [
      ['maintenance', '3', 'Maintenance'],
      ['invalid_amount', '5', 'Invalid amount'],
      ['order_not_found', '303', 'Order not found'],
    ];
    for (const [decision, status, statusText] of cases) {
      expect(createWebhookResponse(CHECK, decision).result).toEqual({ status, statusText });
    }
  });

  it('echoes a string JSON-RPC id', () => {
    expect(createWebhookResponse({ ...CHECK, id: 'correlation-1' }, 'accept').id).toBe(
      'correlation-1',
    );
  });

  it.each<[string, unknown, unknown, string, PaylovInputRule]>([
    ['an unknown decision', CHECK, 'success', 'decision', 'format'],
    ['an inherited property name', CHECK, 'toString', 'decision', 'format'],
    ['a raw status code', CHECK, '0', 'decision', 'format'],
    ['a missing decision', CHECK, undefined, 'decision', 'required'],
    ['blank custom text', CHECK, { custom: '  ' }, 'decision.custom', 'required'],
    ['non-string custom text', CHECK, { custom: 7 }, 'decision.custom', 'type'],
    ['a null JSON-RPC id', { ...CHECK, id: null }, 'accept', 'event.id', 'type'],
    ['a NaN JSON-RPC id', { ...CHECK, id: Number.NaN }, 'accept', 'event.id', 'type'],
    [
      'a notification event',
      { kind: 'transaction.cancel', id: 1 },
      'accept',
      'event.kind',
      'format',
    ],
    ['a null event', null, 'accept', 'event', 'type'],
  ])('rejects %s', async (_case, event, decision, field, rule) => {
    await expectInputError(() => createWebhookResponse(event as never, decision as never), {
      field,
      rule,
    });
  });
});
