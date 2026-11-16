import { describe, expect, it } from 'vitest';

import {
  fromUnixSeconds,
  parseIsoDateTime,
  parseTashkentDateTime,
  parseUtcDateTime,
} from '../../src/core/time.js';

const MALFORMED_LOCAL = [
  '2026-11-12T10:00:00',
  '2026-11-12 10:00',
  '2026-11-12 10:00:00.123',
  '2026-11-12 10:00:00+05:00',
  ' 2026-11-12 10:00:00',
  '26-11-12 10:00:00',
  '',
];
const IMPOSSIBLE_LOCAL = [
  '2026-02-29 10:00:00',
  '2026-13-01 10:00:00',
  '2026-00-10 10:00:00',
  '2026-04-31 10:00:00',
  '2026-11-12 24:00:00',
  '2026-11-12 10:60:00',
  '2026-11-12 10:00:60',
];

describe('parseTashkentDateTime', () => {
  it('reads the wall clock as a fixed +05:00 offset', () => {
    expect(parseTashkentDateTime('2026-11-12 10:15:30')?.toISOString()).toBe(
      '2026-11-12T05:15:30.000Z',
    );
  });

  it('crosses the UTC day boundary without a time-zone database', () => {
    expect(parseTashkentDateTime('2026-01-01 03:00:00')?.toISOString()).toBe(
      '2025-12-31T22:00:00.000Z',
    );
  });

  it('accepts a leap day and keeps years below 100 literal', () => {
    expect(parseTashkentDateTime('2024-02-29 05:00:00')?.toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
    expect(parseTashkentDateTime('0050-06-01 05:00:00')?.getUTCFullYear()).toBe(50);
  });

  it.each([...MALFORMED_LOCAL, ...IMPOSSIBLE_LOCAL])('rejects %j', (value) => {
    expect(parseTashkentDateTime(value)).toBeUndefined();
  });
});

describe('parseUtcDateTime', () => {
  it('reads the wall clock as UTC', () => {
    expect(parseUtcDateTime('2026-11-12 10:15:30')?.toISOString()).toBe('2026-11-12T10:15:30.000Z');
  });

  it.each(['2026-11-12T10:00:00', '2026-02-29 10:00:00'])('rejects %j', (value) => {
    expect(parseUtcDateTime(value)).toBeUndefined();
  });
});

describe('parseIsoDateTime', () => {
  it.each([
    ['2026-11-12T10:15:30Z', '2026-11-12T10:15:30.000Z'],
    ['2026-11-12T10:15:30+05:00', '2026-11-12T05:15:30.000Z'],
    ['2026-11-12T10:15:30-03:30', '2026-11-12T13:45:30.000Z'],
    ['2026-11-12T10:15:30.5+05:00', '2026-11-12T05:15:30.500Z'],
    ['2026-11-12T10:15:30.123456+05:00', '2026-11-12T05:15:30.123Z'],
  ])('parses %s', (value, expected) => {
    expect(parseIsoDateTime(value)?.toISOString()).toBe(expected);
  });

  it.each([
    '2026-11-12T10:15:30',
    '2026-11-12 10:15:30Z',
    '2026-11-12T10:15:30.1234567Z',
    '2026-11-12T10:15:30+0500',
    '2026-11-12T10:15:30+24:00',
    '2026-11-12T10:15:30+05:60',
    '2026-02-30T10:15:30Z',
    '2026-11-12T25:15:30Z',
  ])('rejects %s', (value) => {
    expect(parseIsoDateTime(value)).toBeUndefined();
  });
});

describe('fromUnixSeconds', () => {
  it('converts non-negative safe-integer seconds', () => {
    expect(fromUnixSeconds(0)?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(fromUnixSeconds(1_762_934_400)?.toISOString()).toBe('2025-11-12T08:00:00.000Z');
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'rejects %s, including seconds outside the Date range',
    (value) => {
      expect(fromUnixSeconds(value)).toBeUndefined();
    },
  );
});
