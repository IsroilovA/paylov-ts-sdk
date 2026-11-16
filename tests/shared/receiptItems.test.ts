import { describe, expect, it } from 'vitest';

import { readParams } from '../../src/core/params.js';
import { readReceiptItem } from '../../src/shared/receiptItems.js';
import { expectInputError, expectNoSecretLeak } from '../helpers/asserts.js';

const PINFL = '88888888888888';
const TIN = '123456789';
const ITEM = {
  title: 'Coffee',
  priceTiyin: 1_500_000,
  count: 2,
  code: '10202001001000000',
  vatPercent: 12,
  packageCode: '1545721',
};

function read(items: unknown): unknown {
  return readParams({ items }, 'fiscalization.registerReceipt').array('items', readReceiptItem);
}

describe('readReceiptItem', () => {
  it('maps each item to its wire form with tin or pinfl', () => {
    expect(
      read([
        { ...ITEM, tin: TIN },
        { ...ITEM, pinfl: PINFL },
      ]),
    ).toEqual([
      {
        title: 'Coffee',
        price: 1_500_000,
        count: 2,
        code: '10202001001000000',
        vat_percent: 12,
        package_code: '1545721',
        tin: TIN,
      },
      {
        title: 'Coffee',
        price: 1_500_000,
        count: 2,
        code: '10202001001000000',
        vat_percent: 12,
        package_code: '1545721',
        pinfl: PINFL,
      },
    ]);
  });

  it('requires the items array', async () => {
    await expectInputError(() => read(undefined), { field: 'items', rule: 'required' });
  });

  it('requires exactly one of tin or pinfl, without quoting either', async () => {
    for (const item of [ITEM, { ...ITEM, tin: TIN, pinfl: PINFL }]) {
      const error = await expectInputError(() => read([item]), {
        field: 'items[0]',
        rule: 'exclusive',
      });
      expectNoSecretLeak(error, [PINFL]);
    }
  });

  it.each([
    [
      { priceTiyin: 1.5 },
      { code: 'sdk_invalid_amount', field: 'items[0].priceTiyin', rule: 'type' },
    ],
    [
      { discountTiyin: -1 },
      { code: 'sdk_invalid_amount', field: 'items[0].discountTiyin', rule: 'type' },
    ],
    [{ count: 1.5 }, { field: 'items[0].count', rule: 'type' }],
    [{ title: '' }, { field: 'items[0].title', rule: 'required' }],
  ] as const)('rejects %j', async (override, expected) => {
    await expectInputError(() => read([{ ...ITEM, tin: TIN, ...override }]), expected);
  });

  it('sends discountTiyin as the tiyin discount', () => {
    expect(read([{ ...ITEM, tin: TIN, discountTiyin: 500 }])).toEqual([
      expect.objectContaining({ price: 1_500_000, discount: 500 }),
    ]);
  });

  it('sends only the keys it reads', () => {
    expect(read([{ ...ITEM, tin: TIN, discount: 5 }])).toEqual(read([{ ...ITEM, tin: TIN }]));
  });
});
