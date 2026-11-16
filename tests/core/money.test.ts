import { describe, expect, it } from 'vitest';

import {
  formatSum,
  readTiyin,
  sumToTiyin,
  tiyinToWireSum,
  wireSumToTiyin,
} from '../../src/core/money.js';
import { expectInputError, expectNoSecretLeak } from '../helpers/asserts.js';

const AMOUNT = 'sdk_invalid_amount';

const NOT_TIYIN: [string, unknown][] = [
  ['negative', -1],
  ['fractional', 1.5],
  ['float artefact', 0.1 + 0.2],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['above MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 2],
  ['numeric string', '100'],
  ['null', null],
  ['object', {}],
  ['bigint', 10n],
];

describe('readTiyin', () => {
  it('returns a valid amount unchanged', () => {
    expect(readTiyin(150, 'amountTiyin')).toBe(150);
    expect(readTiyin(Number.MAX_SAFE_INTEGER, 'amountTiyin')).toBe(Number.MAX_SAFE_INTEGER);
    expect(readTiyin(0, 'amountTiyin')).toBe(0);
  });

  it('requires a value', async () => {
    await expectInputError(() => readTiyin(undefined, 'amountTiyin'), {
      code: AMOUNT,
      field: 'amountTiyin',
      rule: 'required',
    });
  });

  it.each(NOT_TIYIN)('rejects %s as a type error', async (_label, value) => {
    await expectInputError(() => readTiyin(value, 'amountTiyin'), {
      code: AMOUNT,
      field: 'amountTiyin',
      rule: 'type',
    });
  });

  it('names the field and label but never quotes the rejected value', async () => {
    const pan = ['860012', '341234', '1234'].join('');
    const error = await expectInputError(
      () =>
        readTiyin(pan, 'items[0].priceTiyin', 'fiscalization.registerReceipt: items[0].priceTiyin'),
      { code: AMOUNT, field: 'items[0].priceTiyin', rule: 'type' },
    );
    expect(error.message).toBe(
      'fiscalization.registerReceipt: items[0].priceTiyin must be a non-negative safe integer',
    );
    expectNoSecretLeak(error, [pan]);
  });
});

describe('wireSumToTiyin', () => {
  it('converts wire SUM and rejects what cannot be tiyin', () => {
    expect(wireSumToTiyin(25_000)).toBe(2_500_000);
    expect(wireSumToTiyin(1.5)).toBeUndefined();
    expect(wireSumToTiyin('100')).toBeUndefined();
    expect(wireSumToTiyin(Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });
});

describe('tiyinToWireSum', () => {
  it('converts whole SUM amounts only', () => {
    expect(tiyinToWireSum(250_000)).toBe(2_500);
    expect(tiyinToWireSum(0)).toBe(0);
    expect(tiyinToWireSum(150)).toBeUndefined();
    expect(tiyinToWireSum(-100)).toBeUndefined();
  });
});

describe('sumToTiyin', () => {
  it.each([
    [0, 0],
    [1000, 100_000],
    ['0', 0],
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['007.10', 710],
    ['90071992547409.91', 9_007_199_254_740_991],
  ] as const)('converts %j SUM to %s tiyin exactly', (sum, expected) => {
    expect(sumToTiyin(sum)).toBe(expected);
  });

  it.each([1.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER])('rejects the number %s', async (sum) => {
    await expectInputError(() => sumToTiyin(sum), { code: AMOUNT, field: 'sum', rule: 'type' });
  });

  it.each(['1.234', '-1', '1e3', '.5', '5.', ' 5', '1,5', ''])(
    'rejects the string %j',
    async (sum) => {
      await expectInputError(() => sumToTiyin(sum), { code: AMOUNT, field: 'sum', rule: 'format' });
    },
  );

  it('rejects a decimal string beyond the safe range', async () => {
    await expectInputError(() => sumToTiyin('90071992547409.92'), {
      code: AMOUNT,
      field: 'sum',
      rule: 'range',
    });
    await expectInputError(() => sumToTiyin('9'.repeat(400)), {
      code: AMOUNT,
      field: 'sum',
      rule: 'range',
    });
  });

  it('rejects a non-string, non-number value from JavaScript callers', async () => {
    await expectInputError(() => sumToTiyin({} as never), {
      code: AMOUNT,
      field: 'sum',
      rule: 'format',
    });
  });
});

describe('formatSum', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [100, '1.00'],
    [2_500_000, '25 000.00'],
    [123_456_789, '1 234 567.89'],
  ])('formats %s tiyin as "%s"', (amountTiyin, expected) => {
    expect(formatSum(amountTiyin)).toBe(expected);
  });

  it('rejects invalid amounts before formatting', async () => {
    await expectInputError(() => formatSum(1.5), {
      code: AMOUNT,
      field: 'amountTiyin',
      rule: 'type',
    });
    await expectInputError(() => formatSum(-1), {
      code: AMOUNT,
      field: 'amountTiyin',
      rule: 'type',
    });
  });
});
