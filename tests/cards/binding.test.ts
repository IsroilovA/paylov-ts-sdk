import { describe, expect, it } from 'vitest';

import {
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
} from '../helpers/asserts.js';
import { wireResponse } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/testHttp.js';
import {
  PAN,
  OTP,
  EXPIRY,
  PINFL,
  PHONE,
  UZCARD_ID,
  UZCARD,
  setup,
  withCard,
  bodyKeys,
} from './cardCases.js';

// Expectations come from docs/paylov/cards.md and the fixtures it cites.
describe('cards.startPanBinding', () => {
  const params = { userId: 'user-42', cardNumber: PAN, cardExpiry: EXPIRY };

  it('sends exactly the documented fields and returns the card id and OTP phone', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/startPanBinding.success.wire.json')]);

    const started = await cards.startPanBinding({ ...params, phoneNumber: PHONE });

    expect(started).toEqual({ cardId: UZCARD_ID, otpSentPhone: '+9989*****00' });
    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/userCard/createUserCard/`,
      body: { userId: 'user-42', cardNumber: PAN, expireDate: EXPIRY, phoneNumber: PHONE },
    });
  });

  it('omits an absent phoneNumber', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/startPanBinding.success.wire.json')]);

    await cards.startPanBinding(params);

    expect(bodyKeys(fetchImpl.calls[0])).toEqual(['userId', 'cardNumber', 'expireDate']);
  });

  it('keeps an OTP phone of any mask as an opaque string', async () => {
    const { cards } = setup([
      { body: { result: { cid: UZCARD_ID, otpSentPhone: '********0000' }, error: null } },
    ]);

    await expect(cards.startPanBinding(params)).resolves.toMatchObject({
      otpSentPhone: '********0000',
    });
  });

  it.each([
    ['userId', { userId: ' ' }, 'required'],
    ['cardNumber', { cardNumber: 4111 }, 'type'],
    ['phoneNumber', { phoneNumber: '' }, 'required'],
  ] as const)('refuses an invalid %s before any request', async (field, patch, rule) => {
    const { cards, fetchImpl } = setup([]);

    await expectInputError(cards.startPanBinding({ ...params, ...patch } as never), {
      field,
      rule,
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('keeps the card number out of a gateway error and logger events', async () => {
    const { cards, requests, responses } = setup([
      wireResponse('cards/startPanBinding.cardExists.wire.json'),
    ]);

    const error = await expectApiError(cards.startPanBinding(params), { code: 'card_exists' });

    expectNoSecretLeak(error, [PAN]);
    expect(JSON.stringify([requests, responses])).not.toContain(PAN);
  });

  it('sends an MMYY expiry unchanged and names the field Paylov rejects', async () => {
    const { cards, fetchImpl } = setup([
      wireResponse('cards/startPanBinding.expiryFormat.wire.json'),
    ]);

    await expectApiError(cards.startPanBinding({ ...params, cardExpiry: '1299' }), {
      code: 'validation_error',
      fields: ['expireDate'],
    });
    expect(fetchImpl.calls[0]?.body).toMatchObject({ expireDate: '1299' });
  });
});

describe('cards.confirmPanBinding', () => {
  it('sends the documented fields and decodes the card with its flat status', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/confirmPanBinding.success.wire.json')]);

    const card = await cards.confirmPanBinding({
      cardId: UZCARD_ID,
      otp: OTP,
      cardName: 'SDK UZ',
      pinfl: PINFL,
    });

    expect(card).toEqual(UZCARD);
    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/userCard/confirmUserCardCreate/`,
      body: { cardId: UZCARD_ID, otp: OTP, cardName: 'SDK UZ', pinfl: PINFL },
    });
  });

  it('omits absent optional fields', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/confirmPanBinding.success.wire.json')]);

    await cards.confirmPanBinding({ cardId: UZCARD_ID, otp: OTP });

    expect(bodyKeys(fetchImpl.calls[0])).toEqual(['cardId', 'otp']);
  });

  it('reads an empty cardName as null', async () => {
    const { cards } = setup([
      withCard('cards/confirmPanBinding.success.wire.json', { cardName: '' }),
    ]);

    await expect(cards.confirmPanBinding({ cardId: UZCARD_ID, otp: OTP })).resolves.toMatchObject({
      cardName: null,
    });
  });

  it('rejects the nested status layout, which only get and list use', async () => {
    const nested = { result: { is_active: true, status_message: 'active', sms_info: true } };
    const { cards } = setup([
      withCard('cards/confirmPanBinding.success.wire.json', { status: nested }),
    ]);

    await expectMalformed(
      cards.confirmPanBinding({ cardId: UZCARD_ID, otp: OTP }),
      'result.card.status.is_active',
    );
  });

  it.each([
    ['cardId', { cardId: 42 }, 'type'],
    ['otp', { otp: undefined }, 'required'],
  ] as const)('refuses an invalid %s before any request', async (field, patch, rule) => {
    const { cards, fetchImpl } = setup([]);

    await expectInputError(
      cards.confirmPanBinding({ cardId: UZCARD_ID, otp: OTP, ...patch } as never),
      { field, rule },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('reports how long a card blocked by wrong OTPs stays blocked', async () => {
    const { cards } = setup([wireResponse('cards/confirmPanBinding.cardBlocked.wire.json')]);

    const error = await expectApiError(cards.confirmPanBinding({ cardId: UZCARD_ID, otp: OTP }), {
      code: 'card_is_blocked',
      httpStatus: 400,
    });

    expect(error.retryAfterSeconds).toBe(298);
  });

  it('keeps the OTP and PINFL out of a gateway error and logger events', async () => {
    const { cards, requests, responses } = setup([
      wireResponse('cards/confirmPanBinding.invalidOtp.wire.json'),
    ]);

    const error = await expectApiError(
      cards.confirmPanBinding({ cardId: UZCARD_ID, otp: OTP, pinfl: PINFL }),
      { code: 'invalid_otp' },
    );

    expectNoSecretLeak(error, [OTP, PINFL]);
    const events = JSON.stringify([requests, responses]);
    expect(events).not.toContain(OTP);
    expect(events).not.toContain(PINFL);
  });
});
