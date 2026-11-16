import { describe, expect, it } from 'vitest';

import {
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import { fixtureResponse, loadWire, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/testHttp.js';
import {
  PAN,
  OTP,
  EXPIRY,
  PINFL,
  PHONE,
  UZCARD_ID,
  BIND_TOKEN,
  OWNER,
  UZCARD,
  setup,
  withCard,
  bodyKeys,
} from './cardCases.js';

// Expectations come from docs/paylov/cards.md and the fixtures it cites.
describe('cards.createBindLink', () => {
  it('sends userId and returnUrl and passes the bindUrl host through unchanged', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/createBindLink.success.wire.json')]);

    const link = await cards.createBindLink({
      userId: 'user-42',
      returnUrl: 'https://app.example/wallet/cards',
    });

    expect(link).toEqual({
      token: BIND_TOKEN,
      bindUrl: `https://paylov.uz/card-bind/?token=${BIND_TOKEN}`,
      expiresAt: new Date('2026-11-12T16:11:50.670Z'),
    });
    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/userCard/createBindLink/`,
      body: { userId: 'user-42', returnUrl: 'https://app.example/wallet/cards' },
    });
  });

  it('omits an absent returnUrl', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/createBindLink.success.wire.json')]);

    await cards.createBindLink({ userId: 'user-42' });

    expect(fetchImpl.calls[0]?.body).toEqual({ userId: 'user-42' });
  });

  it.each([
    ['app.example/cards', 'format'],
    ['javascript:alert(1)', 'format'],
    ['', 'required'],
  ] as const)('refuses returnUrl %j before any request', async (returnUrl, rule) => {
    const { cards, fetchImpl } = setup([]);

    await expectInputError(cards.createBindLink({ userId: 'user-42', returnUrl }), {
      field: 'returnUrl',
      rule,
    });

    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('rejects an expiry without an offset', async () => {
    const body = recordOf(structuredClone(loadWire('cards/createBindLink.success.wire.json').body));
    const result = { ...recordOf(body['result']), expiresAt: '2026-11-12T21:11:50' };
    const { cards } = setup([{ body: { ...body, result } }]);

    await expectMalformed(cards.createBindLink({ userId: 'user-42' }), 'result.expiresAt');
  });
});

describe('cards.getBindSession', () => {
  it('reads a fresh session as unbound and keeps the token out of logger events', async () => {
    const { cards, fetchImpl, requests, responses } = setup([
      wireResponse('cards/getBindSession.created.wire.json'),
    ]);

    const session = await cards.getBindSession({ token: BIND_TOKEN });

    expect(session).toEqual({ isBound: false, status: 'created', card: null });
    expect(fetchImpl.calls[0]?.url).toBe(
      `${BASE_URL}/merchant/userCard/bindSession/${BIND_TOKEN}/status/`,
    );
    expect(requests[0]?.endpoint).toBe('GET /merchant/userCard/bindSession/{token}/status/');
    expect(JSON.stringify([requests, responses])).not.toContain(BIND_TOKEN);
  });

  it('percent-encodes the token into one path segment', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/getBindSession.created.wire.json')]);

    await cards.getBindSession({ token: 'a/b?c' });

    expect(fetchImpl.calls[0]?.url).toBe(
      `${BASE_URL}/merchant/userCard/bindSession/a%2Fb%3Fc/status/`,
    );
  });

  it('refuses a dot-segment token before any request', async () => {
    const { cards, fetchImpl } = setup([]);

    await expectInputError(cards.getBindSession({ token: '..' }), {
      field: 'token',
      rule: 'format',
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('decodes the confirmed card with its flat status and an empty cardName as null', async () => {
    const { cards } = setup([wireResponse('cards/getBindSession.confirmed.wire.json')]);

    const session = await cards.getBindSession({ token: BIND_TOKEN });

    expect(session).toEqual({
      isBound: true,
      status: 'confirmed',
      card: {
        cardId: '5eed0000-0000-4000-8000-000000000003',
        userId: 'user-example-3',
        holderName: OWNER,
        cardName: null,
        maskedCardNumber: '860000******0000',
        balanceTiyin: 1_000_000_000,
        bankId: '38',
        bankName: 'Paylov Bank',
        vendor: 'Uzcard',
        processing: 'Uzcard',
        isActive: true,
        processingStatus: 'active',
        isSmsEnabled: true,
      },
    });
  });

  it('reads a pending session whose card key is absent as unbound', async () => {
    const { cards } = setup([{ body: { result: { state: 'card_pending' }, error: null } }]);

    await expect(cards.getBindSession({ token: BIND_TOKEN })).resolves.toEqual({
      isBound: false,
      status: 'card_pending',
      card: null,
    });
  });

  it('rejects a confirmed session without a card', async () => {
    const { cards } = setup([
      { body: { result: { state: 'confirmed', card: null }, error: null } },
    ]);

    await expectMalformed(cards.getBindSession({ token: BIND_TOKEN }), 'result.card');
  });

  it('reads an unconfirmed session as unbound even when it carries a card', async () => {
    const confirmed = recordOf(loadWire('cards/getBindSession.confirmed.wire.json').body);
    const card = recordOf(confirmed['result'])['card'];
    const { cards } = setup([{ body: { result: { state: 'created', card }, error: null } }]);

    await expect(cards.getBindSession({ token: BIND_TOKEN })).resolves.toEqual({
      isBound: false,
      status: 'created',
      card: null,
    });
  });

  it('surfaces link_already_used', async () => {
    const { cards } = setup([
      fixtureResponse('cards/getBindSession.linkAlreadyUsed.synthesized.json', { status: 400 }),
    ]);

    await expectApiError(cards.getBindSession({ token: BIND_TOKEN }), {
      code: 'link_already_used',
    });
  });
});

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

  it('omits an absent phoneNumber and sms', async () => {
    const { cards, fetchImpl } = setup([wireResponse('cards/startPanBinding.success.wire.json')]);

    await cards.startPanBinding(params);

    expect(bodyKeys(fetchImpl.calls[0])).toEqual(['userId', 'cardNumber', 'expireDate']);
  });

  it.each([[{ hash: 'app-hash', templateId: 1 }], [{}]])(
    'forwards sms %j unchanged',
    async (sms) => {
      const { cards, fetchImpl } = setup([wireResponse('cards/startPanBinding.success.wire.json')]);

      await cards.startPanBinding({ ...params, sms });

      expect(fetchImpl.calls[0]?.body).toMatchObject({ sms });
    },
  );

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
    ['sms', { sms: 'app-hash' }, 'type'],
    ['sms.templateId', { sms: { templateId: '1' } }, 'type'],
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

  it('rejects options whose signal is not an AbortSignal before any request', async () => {
    const { cards, fetchImpl } = setup([]);

    await expectInputError(cards.startPanBinding(params, { signal: 'soon' } as never), {
      field: 'signal',
      rule: 'type',
    });
    expect(fetchImpl.calls).toHaveLength(0);
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
