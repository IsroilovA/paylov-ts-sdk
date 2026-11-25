import { describe, expect, it } from 'vitest';

import {
  arrayOf,
  asJsonObject,
  asLiteral,
  asMaskedPan,
  asString,
  asTashkentDateTime,
  asTiyinFromSum,
  asTiyin,
  asUnixDateTime,
  asUuid,
  asUtcDateTime,
  decodePayload,
  fieldOf,
  isRecord,
  nullable,
  nullish,
  readFields,
  toJsonObject,
  type Decoder,
} from '../../src/core/decoding.js';
import { expectMalformed, expectNoSecretLeak } from '../helpers/asserts.js';

const CONTEXT = {
  endpoint: 'GET /merchant/userCard/getCard/{cardId}/',
  httpStatus: 200,
  effect: 'read',
} as const;

function decode<T>(decoder: Decoder<T>, value: unknown): T {
  const decoded = decodePayload(value, CONTEXT, 'result', decoder);
  if (decoded.kind === 'success') return decoded.value;
  throw decoded.error;
}

/** `levels` containers around a leaf, alternating objects and arrays. */
function nested(levels: number): unknown {
  let value: unknown = 'leaf';
  for (let level = 0; level < levels; level += 1) value = level % 2 === 0 ? { x: value } : [value];
  return value;
}

describe('predicates', () => {
  it('isRecord accepts non-array objects only', () => {
    expect([{}, { a: 1 }].map(isRecord)).toEqual([true, true]);
    expect([null, [], 'x', 1].map(isRecord)).toEqual([false, false, false, false]);
  });

  it('asUuid accepts canonical UUIDs in either case', async () => {
    expect(decode(asUuid, '5eed0000-0000-4000-8000-000000000001')).toBe(
      '5eed0000-0000-4000-8000-000000000001',
    );
    expect(decode(asUuid, '5EED0000-0000-4000-8000-00000000000A')).toBe(
      '5EED0000-0000-4000-8000-00000000000A',
    );
    await expectMalformed(() => decode(asUuid, '5eed0000-0000-4000-8000-00000000000'), 'result');
    await expectMalformed(() => decode(asUuid, 42), 'result');
  });

  it('toJsonObject copies JSON trees and rejects non-JSON values', () => {
    const inner = { b: 2 };
    const list: unknown[] = [1, 'x', true, null, inner];
    const tree = { a: list };
    const copy = toJsonObject(tree);
    expect(copy).toEqual({ a: [1, 'x', true, null, { b: 2 }] });
    inner.b = 3;
    list.push('added');
    tree.a = [];
    expect(copy).toEqual({ a: [1, 'x', true, null, { b: 2 }] });
    const values = [Number.NaN, Infinity, () => 1, [Symbol('x')], [undefined], 1n, new Date(0)];
    for (const value of values) {
      expect(toJsonObject({ value })).toBeUndefined();
    }
    expect(toJsonObject(new Date(0))).toBeUndefined();
  });

  it('toJsonObject omits undefined properties and accepts prototype-free objects', () => {
    const bare: Record<string, unknown> = Object.assign(Object.create(null) as object, { b: 1 });
    expect(toJsonObject({ a: undefined, bare })).toEqual({ bare: { b: 1 } });
  });

  it('toJsonObject rejects nesting deeper than 64 levels instead of overflowing the stack', () => {
    expect(toJsonObject({ value: nested(63) })).toEqual({ value: nested(63) });
    expect(toJsonObject({ value: nested(64) })).toBeUndefined();
    expect(toJsonObject({ value: nested(20_000) })).toBeUndefined();
  });
});

describe('field decoding', () => {
  it('reports the failing path and the response, never the value', async () => {
    const secret = 'EXAMPLE-RESPONSE-SECRET-NOT-A-REAL-VALUE';
    const value = { card: { owner: 42, note: secret } };
    const error = await expectMalformed(
      () => decode(fieldOf('card', fieldOf('owner', asString)), value),
      'result.card.owner',
    );
    expect(error).toMatchObject({
      endpoint: CONTEXT.endpoint,
      httpStatus: CONTEXT.httpStatus,
      isOutcomeUnknown: false,
    });
    expectNoSecretLeak(error, [secret]);
  });

  it('lets an exception that is not a decode failure propagate unchanged', () => {
    const bug = new TypeError('decoder bug');
    const broken: Decoder<never> = () => {
      throw bug;
    };
    expect(() => decode(fieldOf('card', broken), { card: 1 })).toThrow(bug);
  });

  it('readFields and asJsonObject reject non-records', async () => {
    await expectMalformed(() => decode(asJsonObject, []), 'result');
    await expectMalformed(() => decode((value, path) => readFields(value, path), null), 'result');
  });

  it('arrayOf reports the index of the failing item', async () => {
    expect(decode(arrayOf(asString), ['a', 'b'])).toEqual(['a', 'b']);
    await expectMalformed(() => decode(arrayOf(asString), ['a', 1]), 'result[1]');
    await expectMalformed(() => decode(arrayOf(asString), { length: 0 }), 'result');
  });
});

describe('scalar decoders', () => {
  it('asTiyin accepts a safe non-negative integer and rejects the rest', async () => {
    expect(decode(asTiyin, 2_500_000)).toBe(2_500_000);
    for (const value of [-1, 0.5, '100'])
      await expectMalformed(() => decode(asTiyin, value), 'result');
  });

  it('asTiyinFromSum converts wire SUM and rejects overflow and fractions', async () => {
    expect(decode(asTiyinFromSum, 25_000)).toBe(2_500_000);
    await expectMalformed(() => decode(asTiyinFromSum, 10.5), 'result');
    await expectMalformed(() => decode(asTiyinFromSum, Number.MAX_SAFE_INTEGER), 'result');
  });

  it('asMaskedPan accepts masks and rejects a full PAN without retaining it', async () => {
    expect(decode(asMaskedPan, '860000******0000')).toBe('860000******0000');
    expect(decode(asMaskedPan, '8600****0000')).toBe('8600****0000');
    const pan = ['860012', '341234', '1234'].join('');
    expectNoSecretLeak(await expectMalformed(() => decode(asMaskedPan, pan), 'result'), [pan]);
    await expectMalformed(() => decode(asMaskedPan, '860000000000'), 'result');
  });

  it('asLiteral accepts only the listed wire values', async () => {
    const status = asLiteral('success', 'ok');
    expect(decode(status, 'ok')).toBe('ok');
    await expectMalformed(() => decode(status, 'OK'), 'result');
    expect(decode(asLiteral(860, 840), 840)).toBe(840);
  });

  it('asJsonObject copies a JSON record and rejects anything else', async () => {
    const account = { order_id: 'A-1', nested: { n: 1 } };
    expect(decode(asJsonObject, account)).toEqual(account);
    await expectMalformed(() => decode(asJsonObject, ['x']), 'result');
    await expectMalformed(() => decode(asJsonObject, { bad: Number.POSITIVE_INFINITY }), 'result');
  });
});

describe('absence', () => {
  it('nullable accepts null but treats an absent key as malformed', async () => {
    expect(decode(nullable(asString), null)).toBeNull();
    expect(decode(nullable(asString), 'x')).toBe('x');
    await expectMalformed(() => decode(nullable(asString), undefined), 'result');
  });

  it('nullish reads both null and an absent key as null', async () => {
    expect(decode(nullish(asString), null)).toBeNull();
    expect(decode(nullish(asString), undefined)).toBeNull();
    expect(decode(nullish(asString), 'x')).toBe('x');
    await expectMalformed(() => decode(nullish(asString), 1), 'result');
  });
});

describe('date decoders', () => {
  it('parse each wire zone to a Date', () => {
    expect(decode(asTashkentDateTime, '2026-11-12 10:00:00').toISOString()).toBe(
      '2026-11-12T05:00:00.000Z',
    );
    expect(decode(asUtcDateTime, '2026-11-12 10:00:00').toISOString()).toBe(
      '2026-11-12T10:00:00.000Z',
    );
    expect(decode(asUnixDateTime, 1_762_934_400).toISOString()).toBe('2025-11-12T08:00:00.000Z');
  });

  it('reject malformed strings and non-strings', async () => {
    await expectMalformed(() => decode(asTashkentDateTime, '2026-11-12T10:00:00'), 'result');
    await expectMalformed(() => decode(asUtcDateTime, '2026-02-30 10:00:00'), 'result');
    await expectMalformed(() => decode(asUnixDateTime, '1762934400'), 'result');
    await expectMalformed(() => decode(asUnixDateTime, -1), 'result');
  });
});
