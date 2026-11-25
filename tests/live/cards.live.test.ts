/**
 * Sandbox cards: refusals of unknown ids, then the Uzcard test card bound by PAN and OTP, read,
 * listed, checked and deleted.
 */

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { isPaylovApiError, type Card } from '../../src/index.js';
import {
  LiveCleanup,
  liveClient,
  liveGate,
  liveUserId,
  observe,
  refused,
  settle,
} from '../helpers/live.js';
import { uzcardTestCard } from './sandboxCards.js';

const gate = await liveGate();
const writes = gate.enabled && gate.config.writes;
const testCard = writes ? await uzcardTestCard() : undefined;

const MASKED_PAN = /^\d{4,6}\*+\d{4}$/;

/** The decoded card contract; comparisons are booleans so no id or card data is printed. */
function expectBoundCard(label: string, card: Card, cardId: string, userId: string): void {
  observe(label, {
    vendor: card.vendor,
    processing: card.processing,
    isActive: card.isActive,
    processingStatus: card.processingStatus,
    isSmsEnabled: card.isSmsEnabled,
    hasCardName: card.cardName !== null,
    hasBankName: card.bankName !== null,
  });
  expect(card.cardId === cardId, `${label}: cardId`).toBe(true);
  expect(card.userId === userId, `${label}: userId`).toBe(true);
  expect(MASKED_PAN.test(card.maskedCardNumber), `${label}: masked card number`).toBe(true);
  expect(card.vendor.toLowerCase()).toBe('uzcard');
  expect(card).toMatchObject({ isActive: true, processingStatus: 'active' });
  expect(Number.isSafeInteger(card.balanceTiyin) && card.balanceTiyin >= 0).toBe(true);
  expect(card.bankId).toMatch(/^\d+$/);
}

describe.skipIf(!gate.enabled)('cards reads', () => {
  if (!gate.enabled) return;
  const client = liveClient(gate.config);

  it('list for a user without cards is empty', async () => {
    const cards = await client.cards.list({ userId: liveUserId('cards-empty') });
    expect(cards.length).toBe(0);
  });

  it('get of an unknown card id is card_not_found', async () => {
    const error = await refused('cards.get.unknown', client.cards.get({ cardId: randomUUID() }));
    expect(error.code).toBe('card_not_found');
  });
});

describe.skipIf(!writes || testCard?.ok !== true)('cards writes: PAN binding', () => {
  if (!gate.enabled || testCard?.ok !== true) return;
  const { config } = gate;
  const client = liveClient(config);
  const card = testCard.value;
  const userId = liveUserId('cards');
  const cleanup = new LiveCleanup();
  let cardId: string | undefined;

  function boundCardId(): string {
    if (cardId === undefined) throw new Error('the PAN binding step did not bind a card');
    return cardId;
  }

  afterAll(() => cleanup.run());

  it('startPanBinding then confirmPanBinding binds the card', async () => {
    const started = await client.cards.startPanBinding({
      userId,
      cardNumber: card.pan,
      cardExpiry: card.expiry,
    });
    cleanup.add(
      'cards.cleanup.delete',
      () => client.cards.delete({ cardId: started.cardId }),
      'card_not_found',
    );
    cardId = started.cardId;
    expect(started.otpSentPhone.length).toBeGreaterThan(0);

    const confirmed = await client.cards.confirmPanBinding({
      cardId: started.cardId,
      otp: card.otp,
    });
    expectBoundCard('cards.confirmPanBinding', confirmed, started.cardId, userId);
    expect(confirmed.maskedCardNumber.slice(-4) === card.pan.slice(-4), 'last four digits').toBe(
      true,
    );
  });

  it('get reads the card with its status flattened', async () => {
    const fetched = await client.cards.get({ cardId: boundCardId() });
    expectBoundCard('cards.get', fetched, boundCardId(), userId);
    expect(fetched.maskedCardNumber.slice(-4) === card.pan.slice(-4), 'last four digits').toBe(
      true,
    );
  });

  it('list holds exactly the bound card, with its status flattened', async () => {
    const cards = await client.cards.list({ userId });
    observe('cards.list', { count: cards.length });
    expect(cards.length).toBe(1);
    const [listed] = cards;
    if (listed === undefined) throw new Error('cards.list is empty');
    expectBoundCard('cards.list', listed, boundCardId(), userId);
  });

  it('checkPhone answers false, phone_not_match, or is not enabled', async () => {
    // A fixed non-subscriber number.
    const outcome = await settle(
      'cards.checkPhone',
      client.cards.checkPhone({ cardId: boundCardId(), phoneNumber: '+998900000000' }),
    );
    const answer = outcome.ok ? outcome.value : outcome.error.code;
    expect([false, 'phone_not_match', 'permission_denied']).toContain(answer);
  });

  it('delete unbinds the card; list and get drop it once their caches expire', async () => {
    const id = boundCardId();
    await expect(client.cards.delete({ cardId: id })).resolves.toBeUndefined();
    const deletedAt = Date.now();
    const again = await refused('cards.delete.repeat', client.cards.delete({ cardId: id }));
    expect(again.code).toBe('card_not_found');
    // `getAllUserCards/` and `getCard/` serve cached copies of a just-deleted card for a while.
    const waitUntilGone = async (label: string, gone: () => Promise<boolean>): Promise<void> => {
      while (!(await gone())) {
        if (Date.now() - deletedAt > 45_000) throw new Error(`${label} kept the deleted card 45 s`);
        await sleep(3_000);
      }
      observe(label, { secondsCached: Math.round((Date.now() - deletedAt) / 1000) });
    };
    await waitUntilGone(
      'cards.list.deleted',
      async () => (await client.cards.list({ userId })).length === 0,
    );
    await waitUntilGone('cards.get.deleted', async () => {
      const outcome = await client.cards.get({ cardId: id }).catch((error: unknown) => error);
      return isPaylovApiError(outcome, 'card_not_found');
    });
  });
});
