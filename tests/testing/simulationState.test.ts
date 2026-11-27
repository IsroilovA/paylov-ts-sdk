import { describe, expect, it } from 'vitest';

import { readPanCard, PAYLOV_FAKE_OTP } from '../../src/testing/panCards.js';
import { GatewaySimulation, type SimulationSettings } from '../../src/testing/simulation.js';
import {
  decodeSimulationState,
  encodeSimulationState,
  type SimulationState,
} from '../../src/testing/simulationState.js';
import { expectInputError } from '../helpers/asserts.js';
import { testCardNumber } from '../helpers/cardNumbers.js';

const USER = 'user-42';
const CARD_NUMBER = testCardNumber('860000000000001');

function roundTrip(state: SimulationState): SimulationState {
  return decodeSimulationState(JSON.parse(JSON.stringify(encodeSimulationState(state))));
}

function resultOf<T>(outcome: { kind: string; value?: T }): T {
  if (outcome.kind !== 'result' || outcome.value === undefined)
    throw new Error('expected a result');
  return outcome.value;
}

/** A state holding every record kind: bindings, deleted and charged cards, sales, holds, receipts. */
function busyState(): SimulationState {
  let now = new Date('2026-11-12T10:00:00Z');
  const settings: SimulationSettings = {
    now: () => now,
    refundWindowMinutes: 60,
    refundReceiptDelaySeconds: 15,
    splitRecipientIds: new Set(),
  };
  const simulation = new GatewaySimulation(settings);
  simulation.addPanCard(readPanCard({ cardNumber: CARD_NUMBER, cardExpiry: '9912' }));
  const binding = { userId: USER, cardNumber: CARD_NUMBER, cardExpiry: '9912' };
  const { cardId } = resultOf(simulation.startPanBinding(binding));
  resultOf(simulation.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP, cardName: 'Main' }));
  resultOf(simulation.listCards({ userId: USER }));
  resultOf(simulation.startPanBinding({ ...binding, userId: 'user-43' }));
  const pending = resultOf(simulation.startPanBinding({ ...binding, userId: 'user-45' }));
  if (simulation.deleteCard({ cardId: pending.cardId }).kind !== 'result')
    throw new Error('pending binding not deleted');
  const other = resultOf(simulation.startPanBinding({ ...binding, userId: 'user-44' }));
  resultOf(simulation.confirmPanBinding({ cardId: other.cardId, otp: PAYLOV_FAKE_OTP }));
  if (simulation.deleteCard({ cardId: other.cardId }).kind !== 'result')
    throw new Error('not deleted');

  resultOf(simulation.createPayment({ amountTiyin: 50_000 }));
  const sale = resultOf(simulation.createPayment({ amountTiyin: 100_000 }));
  resultOf(simulation.pay({ ...sale, cardId, userId: USER }));
  const items = [
    {
      title: 'Consultation',
      priceTiyin: 100_000,
      count: 1,
      code: 'IKPU',
      vatPercent: 12,
      packageCode: 'PACKAGE',
      tin: 'TIN',
    },
  ];
  resultOf(simulation.registerReceipt({ ...sale, items }));
  now = new Date(now.getTime() + 60_000);
  resultOf(simulation.refund(sale));

  const hold = { userId: USER, cardId, amountTiyin: 100_000, durationMinutes: 30 };
  resultOf(simulation.createHold({ ...hold, externalId: 'held' }));
  const captured = resultOf(simulation.createHold({ ...hold, externalId: 'captured' }));
  resultOf(simulation.capture({ ...captured, amountTiyin: 50_000 }));
  const released = resultOf(simulation.createHold({ ...hold, externalId: 'released' }));
  resultOf(simulation.release(released));
  return simulation.state;
}

describe('the simulation state', () => {
  it('reads back every record it writes', () => {
    const state = busyState();
    expect(roundTrip(state)).toEqual(state);
    expect(JSON.stringify(encodeSimulationState(state))).not.toContain(CARD_NUMBER);
  });

  it('continues a restored simulation where it stopped', () => {
    const state = roundTrip(busyState());
    const simulation = new GatewaySimulation(
      {
        now: () => new Date('2026-11-12T11:00:00Z'),
        refundWindowMinutes: undefined,
        refundReceiptDelaySeconds: 15,
        splitRecipientIds: new Set(),
      },
      state,
    );
    expect(simulation.getHold({ externalId: 'captured' })).toMatchObject({
      kind: 'result',
      value: { status: 'captured', amountTiyin: 50_000 },
    });
    expect(
      simulation.createHold({
        userId: USER,
        cardId: '00000000-0000-4000-a000-000000000001',
        amountTiyin: 1000,
        durationMinutes: 1,
        externalId: 'held',
      }),
    ).toEqual({
      kind: 'error',
      code: 'external_id_already_exists',
      failure: {},
    });
  });

  it('names the field of a state that does not read back, never its value', async () => {
    const encoded = encodeSimulationState(busyState());
    if (typeof encoded !== 'object' || encoded === null) throw new Error('expected an object');
    await expectInputError(() => decodeSimulationState({ ...encoded, version: 2 }), {
      code: 'sdk_config_error',
      field: 'version',
      rule: 'format',
    });
    await expectInputError(() => decodeSimulationState({ ...encoded, cards: [{ card: {} }] }), {
      code: 'sdk_config_error',
      field: 'cards[0].card.cardId',
      rule: 'required',
    });
    await expectInputError(() => decodeSimulationState('text'), {
      code: 'sdk_config_error',
      field: undefined,
      rule: 'type',
    });
  });
});
