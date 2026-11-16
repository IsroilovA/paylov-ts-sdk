import { describe, expect, it } from 'vitest';

import {
  captureAsync,
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import { fixtureResponse, loadWire, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/testHttp.js';
import { UZCARD_ID, HUMO_ID, FULL_PAN, UZCARD, setup, withCard } from './cardCases.js';

// Expectations come from docs/paylov/cards.md and the fixtures it cites.
describe('cards.get', () => {
  it('reads the card with its nested status and keeps the id out of logger events', async () => {
    const { cards, fetchImpl, requests } = setup([wireResponse('cards/get.active.wire.json')]);

    await expect(cards.get({ cardId: UZCARD_ID })).resolves.toEqual(UZCARD);
    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'GET',
      url: `${BASE_URL}/merchant/userCard/getCard/${UZCARD_ID}/`,
    });
    expect(requests[0]?.endpoint).toBe('GET /merchant/userCard/getCard/{cardId}/');
  });

  it('decodes a blocked card without bankName', async () => {
    const { cards } = setup([fixtureResponse('cards/get.blocked.docs.json')]);

    await expect(
      cards.get({ cardId: '1a11a111-b6c1-43c2-b1ae-ee3f7b51231f' }),
    ).resolves.toMatchObject({
      bankName: null,
      vendor: 'MIR',
      isActive: false,
      processingStatus: 'stolen_card_capture',
      isSmsEnabled: true,
    });
  });

  it('rejects the flat status layout', async () => {
    const flat = { is_active: true, status_message: 'active', sms_info: true };
    const { cards } = setup([withCard('cards/get.active.wire.json', { status: flat })]);

    await expectMalformed(cards.get({ cardId: UZCARD_ID }), 'result.card.status.result');
  });

  it('rejects a full card number without retaining it', async () => {
    const { cards } = setup([withCard('cards/get.active.wire.json', { number: FULL_PAN })]);

    const error = await expectMalformed(cards.get({ cardId: UZCARD_ID }), 'result.card.number');

    expectNoSecretLeak(error, [FULL_PAN]);
  });

  it.each([
    ['balance', { balance: 10.5 }],
    ['cardId', { cardId: 42 }],
  ])('rejects a malformed %s', async (field, patch) => {
    const { cards } = setup([withCard('cards/get.active.wire.json', patch)]);

    await expectMalformed(cards.get({ cardId: UZCARD_ID }), `result.card.${field}`);
  });

  it('rejects a result without a card', async () => {
    const { cards } = setup([fixtureResponse('cards/get.malformed.synthesized.json')]);

    await expectMalformed(cards.get({ cardId: UZCARD_ID }), 'result.card');
  });

  it('refuses a dot-segment card id before any request', async () => {
    const { cards, fetchImpl } = setup([]);

    await expectInputError(cards.get({ cardId: '..' }), { field: 'cardId', rule: 'format' });
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('cards.list', () => {
  it('sends userId as a query and decodes every card with its nested status', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/list.success.wire.json')]);

    const list = await cards.list({ userId: 'user-example-1' });

    expect(list.map((card) => [card.cardId, card.vendor, card.maskedCardNumber])).toEqual([
      [HUMO_ID, 'Humo', '986000******0000'],
      [UZCARD_ID, 'Uzcard', '860000******0000'],
    ]);
    // DEV reports balances up to about 2 × 10^13 tiyin; they must stay exact.
    expect(list[0]?.balanceTiyin).toBe(19_401_865_801_108);
    expect(list[1]).toEqual({ ...UZCARD, balanceTiyin: 19_401_865_801_108 });
    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'GET',
      url: `${BASE_URL}/merchant/userCard/getAllUserCards/?userId=user-example-1`,
    });
  });

  it("forwards the caller's signal", async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/list.empty.wire.json')]);

    const error = await captureAsync(
      cards.list({ userId: 'user-42' }, { signal: AbortSignal.abort() }),
    );

    expect(error).toMatchObject({ kind: 'connection', code: 'sdk_aborted' });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('returns an empty list for a user without cards', async () => {
    const { cards } = setup([wireResponse('cards/list.empty.wire.json')]);

    await expect(cards.list({ userId: 'user-without-cards' })).resolves.toEqual([]);
  });

  it('rejects the flat status layout the docs show', async () => {
    const body = recordOf(structuredClone(loadWire('cards/list.success.wire.json').body));
    const list = recordOf(body['result'])['cards'];
    const first: unknown = Array.isArray(list) ? list[0] : undefined;
    const flat = { is_active: true, status_message: 'active', sms_info: true };
    const card = { ...recordOf(first), status: flat };
    const { cards } = setup([{ body: { result: { cards: [card] }, error: null } }]);

    await expectMalformed(cards.list({ userId: 'user-42' }), 'result.cards[0].status.result');
  });
});

describe('cards.delete', () => {
  it('sends the card id as userCardId and resolves on result true', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/delete.success.wire.json')]);

    await expect(cards.delete({ cardId: UZCARD_ID })).resolves.toBeUndefined();
    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'DELETE',
      url: `${BASE_URL}/merchant/userCard/deleteUserCard/?userCardId=${UZCARD_ID}`,
    });
  });

  it('surfaces card_not_found with HTTP 404 for an already deleted card', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/delete.notFound404.wire.json')]);

    await expectApiError(cards.delete({ cardId: UZCARD_ID }), {
      code: 'card_not_found',
      httpStatus: 404,
    });
    expect(fetchImpl.calls).toHaveLength(1);
  });
});
