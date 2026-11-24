/**
 * Sandbox fiscalization: receipt lookups, and registration refused on the test merchant, where
 * fiscalization is not enabled.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { externalId, liveClient, liveGate, observe, refused } from '../helpers/live.js';
import { bindTestCard, uzcardTestCard, type BoundCard } from './sandboxCards.js';

const gate = await liveGate();
const writes = gate.enabled && gate.config.writes;
const testCard = writes ? await uzcardTestCard() : undefined;

const PAYMENT_TIYIN = 100_000; // 1 000 SUM

describe.skipIf(!gate.enabled)('fiscalization reads', () => {
  if (!gate.enabled) return;
  const client = liveClient(gate.config);

  it('getReceipt of an unknown transactionId is transaction_not_found, of an unknown externalId null', async () => {
    const byId = await refused(
      'fiscalization.getReceipt.unknown-id',
      client.fiscalization.getReceipt({ transactionId: randomUUID() }),
    );
    expect(byId).toMatchObject({ kind: 'api', code: 'transaction_not_found' });
    const byExternal = await client.fiscalization.getReceipt({
      externalId: externalId('receipt'),
    });
    observe('fiscalization.getReceipt.unknown-external', { found: byExternal !== null });
    expect(byExternal).toBeNull();
  });
});

describe.skipIf(!writes || testCard?.ok !== true)('fiscalization writes', () => {
  if (!gate.enabled || testCard?.ok !== true) return;
  const client = liveClient(gate.config);
  const card = testCard.value;
  let bound: BoundCard | undefined;
  let paidId: string | undefined;

  function paidTransactionId(): string {
    if (paidId === undefined) throw new Error('the fiscalization lane has no paid transaction');
    return paidId;
  }

  beforeAll(async () => {
    bound = await bindTestCard(client, card, 'fiscalization');
    const { userId, card: boundCard } = bound;
    const { transactionId } = await client.payments.create({
      amountTiyin: PAYMENT_TIYIN,
      account: { order_id: externalId('fiscal') },
      userId,
    });
    await client.payments.pay({ transactionId, cardId: boundCard.cardId, userId });
    paidId = transactionId;
  });

  afterAll(async () => {
    await bound?.release();
  });

  it('getReceipt of a paid, unfiscalized payment is null', async () => {
    const receipt = await client.fiscalization.getReceipt({
      transactionId: paidTransactionId(),
      isRefund: false,
    });
    observe('fiscalization.getReceipt.paid', { found: receipt !== null });
    expect(receipt).toBeNull();
  });

  it('registerReceipt is permission_denied', async () => {
    const error = await refused(
      'fiscalization.registerReceipt',
      client.fiscalization.registerReceipt({
        transactionId: paidTransactionId(),
        items: [
          {
            title: 'SDK live suite item',
            priceTiyin: PAYMENT_TIYIN,
            count: 1,
            code: '00000000000000000',
            vatPercent: 0,
            packageCode: '0000000',
            tin: '000000000',
          },
        ],
      }),
    );
    expect(error).toMatchObject({
      kind: 'api',
      code: 'permission_denied',
    });
  });
});
