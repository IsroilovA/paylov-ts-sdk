import { describe, expect, it } from 'vitest';

import { expectApiError, expectMalformed } from '../helpers/asserts.js';
import { fixtureResponse, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/testHttp.js';
import { PHONE, UZCARD_ID, setup } from './cardCases.js';

// Expectations come from docs/paylov/cards.md and the fixtures it cites.
describe('cards.checkPhone', () => {
  const params = { cardId: UZCARD_ID, phoneNumber: PHONE };

  it('sends phoneNumber, not the documented phone key, and returns the match', async () => {
    const { cards, fetchImpl } = setup([fixtureResponse('cards/checkPhone.match.docs.json')]);

    await expect(cards.checkPhone(params)).resolves.toBe(true);
    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/userCard/checkPhoneMatch/`,
      body: { cardId: UZCARD_ID, phoneNumber: PHONE },
    });
  });

  it('answers false for match false', async () => {
    const { cards } = setup([{ body: { result: { match: false }, error: null } }]);

    await expect(cards.checkPhone(params)).resolves.toBe(false);
  });

  it('throws every gateway code, phone_not_match included', async () => {
    const { cards } = setup([
      wireResponse('cards/checkPhone.phoneNotMatch.wire.json'),
      wireResponse('cards/get.cardNotFound.wire.json'),
      { status: 400, body: { result: null, error: { code: 'permission_denied', message: 'x' } } },
    ]);

    await expectApiError(cards.checkPhone(params), { code: 'phone_not_match' });
    await expectApiError(cards.checkPhone(params), { code: 'card_not_found' });
    await expectApiError(cards.checkPhone(params), { code: 'permission_denied' });
  });

  it('rejects a result without a boolean match', async () => {
    const { cards } = setup([{ body: { result: { match: 'yes' }, error: null } }]);

    await expectMalformed(cards.checkPhone(params), 'result.match');
  });
});
