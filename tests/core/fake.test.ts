import { describe, expect, it } from 'vitest';

import { tashkentDateTimeOf, unixSecondsOf, utcDateTimeOf } from '../../src/core/fake.js';
import { fromUnixSeconds, parseTashkentDateTime, parseUtcDateTime } from '../../src/core/time.js';
import { capture } from '../helpers/asserts.js';

describe('fake wire time encoders', () => {
  const instant = new Date('2026-12-31T21:30:05Z');

  it('write the text each parser reads back', () => {
    expect(tashkentDateTimeOf(instant, 'at')).toBe('2027-01-01 02:30:05');
    expect(parseTashkentDateTime('2027-01-01 02:30:05')).toEqual(instant);
    expect(utcDateTimeOf(instant, 'at')).toBe('2026-12-31 21:30:05');
    expect(parseUtcDateTime('2026-12-31 21:30:05')).toEqual(instant);
    expect(utcDateTimeOf(new Date('0005-01-02T00:00:00Z'), 'at')).toBe('0005-01-02 00:00:00');
    expect(unixSecondsOf(instant, 'at')).toBe(1_798_752_605);
    expect(fromUnixSeconds(1_798_752_605)).toEqual(instant);
  });

  it.each([
    ['sub-second', new Date(1_500)],
    ['invalid', new Date(Number.NaN)],
    ['five-digit year', new Date('+010000-01-01T00:00:00Z')],
    ['negative year', new Date('-000001-01-01T00:00:00Z')],
  ])('refuse a %s instant', (_case, date) => {
    expect(capture(() => tashkentDateTimeOf(date, 'at'))).toBeInstanceOf(TypeError);
    expect(capture(() => utcDateTimeOf(date, 'at'))).toBeInstanceOf(TypeError);
  });

  it.each([
    ['sub-second', new Date(1_500)],
    ['pre-1970', new Date(-1_000)],
    ['invalid', new Date(Number.NaN)],
  ])('refuse unix seconds for a %s instant', (_case, date) => {
    expect(capture(() => unixSecondsOf(date, 'at'))).toBeInstanceOf(TypeError);
  });
});
