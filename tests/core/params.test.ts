import { describe, expect, it } from 'vitest';

import {
  everyLiteral,
  readCallSignal,
  readConfig,
  readParams,
  type Params,
} from '../../src/core/params.js';
import { expectInputError, expectNoSecretLeak } from '../helpers/asserts.js';

const METHOD = 'holds.create';
const SECRET = 'EXAMPLE-PARAM-SECRET-NOT-A-REAL-VALUE';
const UUID = '5eed0000-0000-4000-8000-000000000001';

function readTitle(item: Params): string {
  return item.string('title');
}

function readName(organization: Params): string {
  return organization.string('name');
}

function noop(): void {
  // A function value for raw().
}

function params(value: Record<string, unknown>): Params {
  return readParams(value, METHOD);
}

describe('readParams', () => {
  it('rejects anything but an object', async () => {
    for (const value of [undefined, null, [], 'x', 1]) {
      const error = await expectInputError(() => readParams(value, METHOD), {
        field: undefined,
        rule: 'type',
      });
      expect(error.message).toBe('holds.create expects an object');
    }
  });

  it('readConfig reports configuration failures as sdk_config_error', async () => {
    await expectInputError(() => readConfig(null, 'PaylovClient config'), {
      code: 'sdk_config_error',
      field: undefined,
      rule: 'type',
    });
    await expectInputError(() => readConfig({}, 'PaylovClient config').string('baseUrl'), {
      code: 'sdk_config_error',
      field: 'baseUrl',
      rule: 'required',
    });
  });

  it('ignores inherited properties', async () => {
    await expectInputError(
      () =>
        params(Object.create({ userId: 'u' }) as object as Record<string, unknown>).string(
          'userId',
        ),
      { field: 'userId', rule: 'required' },
    );
  });
});

describe('strings', () => {
  it('requires a non-blank string and names the method and field', async () => {
    const error = await expectInputError(() => params({}).string('userId'), {
      field: 'userId',
      rule: 'required',
    });
    expect(error.message).toBe('holds.create: userId is required');
    await expectInputError(() => params({ userId: '  ' }).string('userId'), {
      field: 'userId',
      rule: 'required',
    });
    await expectInputError(() => params({ userId: 42 }).string('userId'), {
      field: 'userId',
      rule: 'type',
    });
  });

  it('optionalString passes undefined through', () => {
    expect(params({}).optionalString('cardName')).toBeUndefined();
    expect(params({ cardName: 'Main' }).optionalString('cardName')).toBe('Main');
  });
});

describe('numbers, booleans and literals', () => {
  it('integer enforces safe integers and the range', async () => {
    expect(params({ timeMinutes: 60 }).integer('timeMinutes')).toBe(60);
    await expectInputError(() => params({ count: 1.5 }).integer('count'), {
      field: 'count',
      rule: 'type',
    });
    const range = { min: 1, max: 5 };
    expect(params({ n: 5 }).optionalInteger('n', range)).toBe(5);
    const between = await expectInputError(() => params({ n: 9 }).optionalInteger('n', range), {
      field: 'n',
      rule: 'range',
    });
    expect(between.message).toBe('holds.create: n must be between 1 and 5');
    await expectInputError(() => params({ n: 0 }).optionalInteger('n', range), {
      field: 'n',
      rule: 'range',
    });
    expect(params({}).optionalInteger('page')).toBeUndefined();
  });

  it('boolean accepts booleans only', async () => {
    await expectInputError(() => params({ refunded: 'false' }).optionalBoolean('refunded'), {
      field: 'refunded',
      rule: 'type',
    });
    expect(params({}).optionalBoolean('refunded')).toBeUndefined();
    expect(params({ refunded: true }).optionalBoolean('refunded')).toBe(true);
  });

  it('literal accepts a closed set and lists it in the message', async () => {
    expect(params({ gender: 'male' }).literal('gender', ['male', 'female'])).toBe('male');
    expect(params({ currency: 840 }).optionalLiteral('currency', [860, 840])).toBe(840);
    expect(params({}).optionalLiteral('currency', [860, 840])).toBeUndefined();
    const error = await expectInputError(
      () => params({ currency: '860' }).literal('currency', [860, 840]),
      { field: 'currency', rule: 'format' },
    );
    expect(error.message).toBe('holds.create: currency must be one of 860, 840');
  });

  it('everyLiteral lists a union exactly, at compile time', () => {
    type Gender = 'male' | 'female';
    const genders: readonly ['male', 'female'] = everyLiteral<Gender>()(['male', 'female']);
    expect(params({ gender: 'female' }).literal('gender', genders)).toBe('female');
    // @ts-expect-error a member of the union is missing
    everyLiteral<Gender>()(['male']);
    // @ts-expect-error a value outside the union
    everyLiteral<Gender>()(['male', 'female', 'other']);
  });
});

describe('URLs', () => {
  it('url requires an absolute http(s) URL, or https only', async () => {
    expect(params({ returnUrl: 'http://shop.example/r' }).url('returnUrl')).toBe(
      'http://shop.example/r',
    );
    await expectInputError(() => params({ returnUrl: 'ftp://shop.example/' }).url('returnUrl'), {
      field: 'returnUrl',
      rule: 'format',
    });
    await expectInputError(() => params({ returnUrl: '/relative' }).url('returnUrl'), {
      field: 'returnUrl',
      rule: 'format',
    });
    expect(params({}).optionalUrl('returnUrl')).toBeUndefined();
    expect(params({ returnUrl: 'https://a.example/' }).optionalUrl('returnUrl')).toBe(
      'https://a.example/',
    );
  });
});

describe('structured values', () => {
  it('json takes an independent JSON snapshot of that field only', () => {
    const account = { order_id: 'A-1', nested: { list: [1, 'x', null] }, dropped: undefined };
    const snapshot = params({ account }).json('account');
    account.nested.list.push(2);
    expect(snapshot).toEqual({ order_id: 'A-1', nested: { list: [1, 'x', null] } });
    expect(params({}).optionalJson('account')).toBeUndefined();
  });

  it('json rejects non-objects and values JSON cannot carry, without their content', async () => {
    const cyclic: Record<string, unknown> = { pan: SECRET };
    cyclic['self'] = cyclic;
    const throwing = Object.defineProperty({}, 'x', {
      enumerable: true,
      get(): never {
        throw new Error(SECRET);
      },
    });
    for (const account of [[1], 'x', cyclic, throwing, { amount: 1n }, { toJSON: () => 'x' }]) {
      const error = await expectInputError(() => params({ account }).json('account'), {
        field: 'account',
        rule: 'type',
      });
      expectNoSecretLeak(error, [SECRET]);
    }
    await expectInputError(() => params({ account: [] }).optionalJson('account'), {
      field: 'account',
      rule: 'type',
    });
  });

  it('stringRecord checks entries, keys and values', async () => {
    const pattern = /^[A-Za-z0-9_-]+$/;
    expect(params({ account: { order_id: 'A-1' } }).stringRecord('account', pattern)).toEqual({
      order_id: 'A-1',
    });
    expect(params({ account: {} }).stringRecord('account', pattern)).toEqual({});
    await expectInputError(
      () => params({ account: { 'Bad Key': 'A' } }).stringRecord('account', pattern),
      { field: 'account', rule: 'format' },
    );
    await expectInputError(
      () => params({ account: { order_id: 1 } }).stringRecord('account', pattern),
      { field: 'account', rule: 'type' },
    );
    const secretValue = await expectInputError(
      () => params({ account: { order_id: `${SECRET} ` } }).stringRecord('account', pattern),
      { field: 'account', rule: 'format' },
    );
    expectNoSecretLeak(secretValue, [SECRET]);
    await expectInputError(() => params({ account: [] }).stringRecord('account', pattern), {
      field: 'account',
      rule: 'type',
    });
  });

  it('array reads items through nested params with indexed field paths', async () => {
    expect(params({ items: [{ title: 'a' }, { title: 'b' }] }).array('items', readTitle)).toEqual([
      'a',
      'b',
    ]);
    await expectInputError(
      () => params({ items: [{ title: 'a' }, {}] }).array('items', readTitle),
      { field: 'items[1].title', rule: 'required' },
    );
    await expectInputError(
      () => params({ items: [{ title: 'a' }, 'b'] }).array('items', readTitle),
      { field: 'items[1]', rule: 'type' },
    );
    await expectInputError(() => params({ items: {} }).array('items', readTitle), {
      field: 'items',
      rule: 'type',
    });
    expect(params({ items: [] }).array('items', readTitle)).toEqual([]);
    const sparse: unknown[] = [{ title: 'a' }];
    sparse.length = 2;
    await expectInputError(() => params({ items: sparse }).array('items', readTitle), {
      field: 'items[1]',
      rule: 'type',
    });
    expect(params({}).optionalArray('items', readTitle)).toBeUndefined();
    expect(params({ items: [{ title: 'c' }] }).optionalArray('items', readTitle)).toEqual(['c']);
  });

  it('object and optionalObject read nested params', async () => {
    expect(params({ organization: { name: 'Org' } }).object('organization', readName)).toBe('Org');
    await expectInputError(
      () => params({ organization: { name: '' } }).object('organization', readName),
      { field: 'organization.name', rule: 'required' },
    );
    await expectInputError(
      () => params({ organization: 'Org' }).optionalObject('organization', readName),
      { field: 'organization', rule: 'type' },
    );
    expect(params({}).optionalObject('organization', readName)).toBeUndefined();
  });

  it('exclusive requires exactly one present key', async () => {
    expect(
      params({ externalId: 'e', transactionId: undefined }).exclusive([
        'transactionId',
        'externalId',
      ]),
    ).toBe('externalId');
    for (const value of [{}, { transactionId: UUID, externalId: 'e' }]) {
      const error = await expectInputError(
        () => params(value).exclusive(['transactionId', 'externalId']),
        { field: undefined, rule: 'exclusive' },
      );
      expect(error.message).toBe('holds.create requires exactly one of transactionId, externalId');
    }
    const nested = await expectInputError(
      () =>
        params({ items: [{ tin: '1', pinfl: '2' }] }).array('items', (item) =>
          item.exclusive(['tin', 'pinfl']),
        ),
      { field: 'items[0]', rule: 'exclusive' },
    );
    expect(nested.message).toBe('holds.create: items[0] requires exactly one of tin, pinfl');
  });

  it('tiyin reports sdk_invalid_amount with the method context', async () => {
    expect(params({ amountTiyin: 0 }).tiyin('amountTiyin')).toBe(0);
    const error = await expectInputError(() => params({ amountTiyin: -1 }).tiyin('amountTiyin'), {
      code: 'sdk_invalid_amount',
      field: 'amountTiyin',
      rule: 'type',
    });
    expect(error.message).toBe('holds.create: amountTiyin must be a non-negative safe integer');
  });

  it('optionalTiyin reads a present amount as tiyin and skips an absent one', async () => {
    expect(params({ discountTiyin: 150 }).optionalTiyin('discountTiyin')).toBe(150);
    expect(params({}).optionalTiyin('discountTiyin')).toBeUndefined();
    await expectInputError(() => params({ discountTiyin: 1.5 }).optionalTiyin('discountTiyin'), {
      code: 'sdk_invalid_amount',
      field: 'discountTiyin',
      rule: 'type',
    });
  });

  it('tiyinAsWholeSum validates tiyin once and returns the whole SUM to send', async () => {
    expect(params({ amountTiyin: 2_500_000 }).tiyinAsWholeSum('amountTiyin')).toBe(25_000);
    expect(params({ amountTiyin: 0 }).tiyinAsWholeSum('amountTiyin')).toBe(0);
    const fraction = await expectInputError(
      () => params({ amountTiyin: 2_500_001 }).tiyinAsWholeSum('amountTiyin'),
      { code: 'sdk_invalid_amount', field: 'amountTiyin', rule: 'format' },
    );
    expect(fraction.message).toBe(
      'holds.create: amountTiyin must be a whole number of SUM (a multiple of 100)',
    );
    await expectInputError(() => params({ amountTiyin: 1.5 }).tiyinAsWholeSum('amountTiyin'), {
      code: 'sdk_invalid_amount',
      field: 'amountTiyin',
      rule: 'type',
    });
  });

  it('raw returns the value as given', () => {
    expect(params({ fetch: noop }).raw('fetch')).toBe(noop);
  });
});

describe('readCallSignal', () => {
  it('accepts no options, empty options and an AbortSignal', () => {
    const { signal } = new AbortController();
    expect(readCallSignal(undefined, 'client.close')).toBeUndefined();
    expect(readCallSignal({}, 'client.close')).toBeUndefined();
    expect(readCallSignal({ signal }, 'client.close')).toBe(signal);
  });

  it('rejects anything else', async () => {
    await expectInputError(() => readCallSignal({ signal: { aborted: true } }, 'client.close'), {
      field: 'signal',
      rule: 'type',
    });
    await expectInputError(() => readCallSignal('signal', 'client.close'), {
      field: undefined,
      rule: 'type',
    });
  });
});
