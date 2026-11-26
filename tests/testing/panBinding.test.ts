import { describe, expect, it } from 'vitest';

import { PaylovClient } from '../../src/client.js';
import { PaylovFakeGateway } from '../../src/testing/gateway.js';
import { PAYLOV_FAKE_OTP, type PaylovFakePanCard } from '../../src/testing/panCards.js';
import { capture, expectApiError } from '../helpers/asserts.js';
import { testCardNumber } from '../helpers/cardNumbers.js';

// Every simulated answer comes from docs/paylov/cards.md (PAN binding, OTP behavior).
const START = new Date('2026-11-12T10:00:00Z');
const USER = 'user-42';
const PHONE = '+998999999999';
const PINFL = '12345678901234';

const CARD_NUMBER = testCardNumber('860000000000001');
const PAN_CARD: PaylovFakePanCard = {
  cardNumber: CARD_NUMBER,
  cardExpiry: '9912',
  phoneNumber: PHONE,
  pinfl: PINFL,
  spendableTiyin: 1_000_000,
};
const START_BINDING = { userId: USER, cardNumber: CARD_NUMBER, cardExpiry: '9912' };

function simulated(panCard: PaylovFakePanCard = PAN_CARD) {
  let now = START;
  const fake = new PaylovFakeGateway({ simulate: true, now: () => now });
  fake.addPanCard(panCard);
  const paylov = new PaylovClient(fake.clientConfig);
  const advance = (seconds: number): void => {
    now = new Date(now.getTime() + seconds * 1000);
  };
  return { fake, paylov, advance };
}

describe('the simulated gateway: PAN binding', () => {
  it('binds a card with the fixed OTP, then pays and holds with it', async () => {
    const { fake, paylov } = simulated();

    const started = await paylov.cards.startPanBinding({ ...START_BINDING, phoneNumber: PHONE });
    expect(started.otpSentPhone).toBe('+9989*****99');
    const card = await paylov.cards.confirmPanBinding({
      cardId: started.cardId,
      otp: PAYLOV_FAKE_OTP,
      pinfl: PINFL,
    });
    expect(card).toMatchObject({
      cardId: started.cardId,
      userId: USER,
      cardName: null,
      maskedCardNumber: '860000******0015',
      balanceTiyin: 1_000_000,
      isActive: true,
      processingStatus: 'active',
    });
    expect(await paylov.cards.list({ userId: USER })).toEqual([card]);

    const { transactionId } = await paylov.payments.create({ amountTiyin: 600_000 });
    await paylov.payments.pay({ transactionId, cardId: card.cardId, userId: USER });
    await paylov.holds.create({
      userId: USER,
      cardId: card.cardId,
      amountTiyin: 400_000,
      durationMinutes: 30,
      externalId: 'booking-1',
    });
    // The spending allowance is used up.
    await expectApiError(
      paylov.holds.create({
        userId: USER,
        cardId: card.cardId,
        amountTiyin: 1000,
        durationMinutes: 30,
        externalId: 'booking-2',
      }),
      { code: 'fake_unsimulated', httpStatus: 501 },
    );
    expect(() => {
      fake.assertDone();
    }).toThrow(/unsimulated holds\.create/);
  });

  it('keeps the OTP usable after a wrong code or PINFL and refuses a second confirm', async () => {
    const { fake, paylov } = simulated();
    const { cardId } = await paylov.cards.startPanBinding(START_BINDING);

    await expectApiError(paylov.cards.confirmPanBinding({ cardId, otp: 'WRONG-OTP' }), {
      code: 'invalid_otp',
    });
    await expectApiError(
      paylov.cards.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP, pinfl: '88888888888888' }),
      { code: 'pinfl_not_match' },
    );
    await paylov.cards.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP, cardName: 'Main' });
    await expectApiError(paylov.cards.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP }), {
      code: 'card_is_already_activated',
      httpStatus: 404,
    });
    expect(await paylov.cards.get({ cardId })).toMatchObject({ cardName: 'Main' });
    fake.assertDone();
  });

  it('expires the OTP after about 90 seconds and leaves the boundary unsimulated', async () => {
    const { fake, paylov, advance } = simulated();
    const { cardId } = await paylov.cards.startPanBinding(START_BINDING);

    advance(90);
    await expectApiError(paylov.cards.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP }), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    advance(2);
    await expectApiError(paylov.cards.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP }), {
      code: 'otp_expired',
    });
    expect(() => {
      fake.assertDone();
    }).toThrow(/about 90 s/);
  });

  it('refuses a repeat while the OTP is valid and reissues it under the same card id', async () => {
    const { fake, paylov, advance } = simulated();
    const { cardId } = await paylov.cards.startPanBinding(START_BINDING);

    advance(80);
    await expectApiError(paylov.cards.startPanBinding(START_BINDING), {
      code: 'otp_code_already_sent',
    });
    advance(17);
    const again = await paylov.cards.startPanBinding(START_BINDING);
    expect(again.cardId).toBe(cardId);
    await paylov.cards.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP });
    await expectApiError(paylov.cards.startPanBinding(START_BINDING), { code: 'card_exists' });

    // Another user binds the same card under a new id.
    const other = await paylov.cards.startPanBinding({ ...START_BINDING, userId: 'user-43' });
    expect(other.cardId).not.toBe(cardId);
    fake.assertDone();
  });

  it('binds the card again after a delete, under a new id', async () => {
    const { fake, paylov } = simulated();
    const first = await paylov.cards.startPanBinding(START_BINDING);
    await paylov.cards.confirmPanBinding({ cardId: first.cardId, otp: PAYLOV_FAKE_OTP });
    await paylov.cards.delete({ cardId: first.cardId });

    const second = await paylov.cards.startPanBinding(START_BINDING);
    expect(second.cardId).not.toBe(first.cardId);
    fake.assertDone();
  });

  it('answers the recorded refusals of the card data', async () => {
    const { fake, paylov } = simulated();

    await expectApiError(paylov.cards.startPanBinding({ ...START_BINDING, cardExpiry: '9913' }), {
      code: 'validation_error',
      fields: ['expireDate'],
    });
    await expectApiError(
      paylov.cards.startPanBinding({
        ...START_BINDING,
        cardNumber: `${CARD_NUMBER.slice(0, -1)}${(Number(CARD_NUMBER.at(-1)) + 1) % 10}`,
      }),
      { code: 'card_not_found', httpStatus: 404 },
    );
    await expectApiError(paylov.cards.startPanBinding({ ...START_BINDING, cardExpiry: '9811' }), {
      code: 'card_not_match',
    });
    await expectApiError(
      paylov.cards.startPanBinding({ ...START_BINDING, phoneNumber: '+998888888888' }),
      { code: 'phone_not_match' },
    );
    await expectApiError(
      paylov.cards.confirmPanBinding({
        cardId: '00000000-0000-4000-8000-0000000000ff',
        otp: PAYLOV_FAKE_OTP,
      }),
      { code: 'card_not_found', httpStatus: 404 },
    );
    fake.assertDone();
  });

  it('leaves unknown cards, the card block and unconfirmed bindings unsimulated', async () => {
    const { fake, paylov } = simulated({ cardNumber: CARD_NUMBER, cardExpiry: '9912' });

    const unknown = { ...START_BINDING, cardNumber: testCardNumber('860000000000002') };
    await expectApiError(paylov.cards.startPanBinding(unknown), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    // A phone or PINFL the card was given without.
    await expectApiError(paylov.cards.startPanBinding({ ...START_BINDING, phoneNumber: PHONE }), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    const { cardId } = await paylov.cards.startPanBinding(START_BINDING);
    await expectApiError(paylov.cards.confirmPanBinding({ cardId, otp: '0', pinfl: PINFL }), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    await expectApiError(paylov.cards.get({ cardId }), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expectApiError(paylov.cards.confirmPanBinding({ cardId, otp: '0' }), {
        code: 'invalid_otp',
      });
    }
    // The 4th wrong code blocks the card for minutes; even the right one is then refused.
    await expectApiError(paylov.cards.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP }), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    expect(() => {
      fake.assertDone();
    }).toThrow(/three wrong OTPs/);
  });

  it('refuses PAN cards it could never bind', () => {
    const fake = new PaylovFakeGateway({ simulate: true });
    const refused = (card: PaylovFakePanCard): unknown =>
      capture(() => {
        fake.addPanCard(card);
      });

    expect(refused({ ...PAN_CARD, cardNumber: CARD_NUMBER.slice(0, -1) })).toBeInstanceOf(
      TypeError,
    );
    expect(refused({ ...PAN_CARD, cardExpiry: '9913' })).toBeInstanceOf(TypeError);
    expect(refused({ ...PAN_CARD, pinfl: '1' })).toBeInstanceOf(TypeError);
    expect(refused({ ...PAN_CARD, phoneNumber: '+998' })).toBeInstanceOf(TypeError);
    expect(refused({ ...PAN_CARD, spendableTiyin: -1 })).toBeInstanceOf(TypeError);
    expect(refused({ ...PAN_CARD, details: { balanceTiyin: 0.5 } })).toBeInstanceOf(TypeError);
    expect(refused({ ...PAN_CARD, details: { holderName: ' ' } })).toBeInstanceOf(TypeError);
    fake.addPanCard(PAN_CARD);
    // The same first six and last four digits.
    expect(refused(PAN_CARD)).toBeInstanceOf(TypeError);
    expect(
      capture(() => {
        new PaylovFakeGateway().addPanCard(PAN_CARD);
      }),
    ).toBeInstanceOf(TypeError);
  });
});
