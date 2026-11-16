import { describe, expect, it } from 'vitest';

import { readParams } from '../../src/core/params.js';
import {
  decodeCheckoutAmount,
  minorUnitsOf,
  readCheckoutAmount,
} from '../../src/shared/checkoutAmount.js';
import { capture } from '../helpers/asserts.js';

function read(amount: unknown): unknown {
  return readCheckoutAmount(readParams({ amount }, 'createCheckoutUrl'), 'amount');
}

describe('readCheckoutAmount', () => {
  it('reads tiyin for UZS and cents for USD', () => {
    expect(read({ currency: 860, amountTiyin: 50_000 })).toEqual({
      currency: 860,
      amountTiyin: 50_000,
    });
    expect(read({ currency: 840, amountCents: 1_999 })).toEqual({
      currency: 840,
      amountCents: 1_999,
    });
  });

  it('rejects the unit of the other currency and unknown currencies', () => {
    expect(capture(() => read({ currency: 840, amountTiyin: 100 }))).toMatchObject({
      code: 'sdk_invalid_amount',
      field: 'amount.amountCents',
      rule: 'required',
    });
    expect(capture(() => read({ currency: 978, amountTiyin: 100 }))).toMatchObject({
      code: 'sdk_invalid_input',
      field: 'amount.currency',
    });
  });

  it('rejects fractional USD amountCents', () => {
    expect(capture(() => read({ currency: 840, amountCents: 19.99 }))).toMatchObject({
      code: 'sdk_invalid_amount',
      field: 'amount.amountCents',
      rule: 'type',
    });
  });
});

describe('minorUnitsOf and decodeCheckoutAmount', () => {
  it('round-trip the wire integer', () => {
    for (const amount of [
      { currency: 860, amountTiyin: 50_000 },
      { currency: 840, amountCents: 1_999 },
    ] as const) {
      expect(decodeCheckoutAmount(minorUnitsOf(amount), amount.currency)).toEqual(amount);
    }
  });

  it('decode nothing from an invalid integer or currency', () => {
    expect(decodeCheckoutAmount(1.5, 860)).toBeUndefined();
    expect(decodeCheckoutAmount('100', 860)).toBeUndefined();
    expect(decodeCheckoutAmount(100, '860')).toBeUndefined();
    expect(decodeCheckoutAmount(100, 978)).toBeUndefined();
  });
});
