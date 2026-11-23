import { describe, expect, it } from 'vitest';

import { readHoldState } from '../../src/holds/state.js';
import type { Hold } from '../../src/holds/types.js';
import { expectInputError } from '../helpers/asserts.js';

// Expectations come from docs/paylov/holds.md: an expired hold keeps reading `hold`, and only a
// dismiss or an expired charge moves it to `cancelled`.
const DEADLINE = new Date('2026-11-12T16:00:00Z');
const BEFORE = new Date('2026-11-12T15:59:59Z');
const CAPTURED_AT = new Date('2026-11-12T15:40:00Z');
const RELEASED_AT = new Date('2026-11-12T15:45:00Z');
const HELD: Hold = {
  transactionId: '00000000-0000-4000-8000-000000000001',
  status: 'held',
  amountTiyin: 100_000,
  capturedAt: null,
  releasedAt: null,
  serviceId: '00000000-0000-4000-8000-000000000003',
};

function stateAt(hold: Hold | null, now: Date) {
  return readHoldState({ hold, clientCaptureDeadline: DEADLINE, now });
}

describe('readHoldState', () => {
  it('reads a held hold before the deadline as open, and at or after it as possibly expired', () => {
    expect(stateAt(HELD, BEFORE)).toEqual({ kind: 'open' });
    expect(stateAt(HELD, DEADLINE)).toEqual({ kind: 'possibly_expired' });
    expect(stateAt(HELD, new Date('2026-12-01T00:00:00Z'))).toEqual({ kind: 'possibly_expired' });
  });

  it('reports a capture with its amount and time, whatever the deadline', () => {
    const captured: Hold = {
      ...HELD,
      status: 'captured',
      amountTiyin: 40_000,
      capturedAt: CAPTURED_AT,
    };
    const state = { kind: 'captured', amountTiyin: 40_000, capturedAt: CAPTURED_AT };
    expect(stateAt(captured, BEFORE)).toEqual(state);
    expect(stateAt(captured, DEADLINE)).toEqual(state);
  });

  it('reports a release with its time', () => {
    const released: Hold = { ...HELD, status: 'released', releasedAt: RELEASED_AT };
    expect(stateAt(released, DEADLINE)).toEqual({ kind: 'released', releasedAt: RELEASED_AT });
  });

  it.each<[string, Hold | null]>([
    ['no hold found', null],
    ['the documented but unobserved created status', { ...HELD, status: 'created' }],
    ['a status outside the vocabulary', { ...HELD, status: 'expired' }],
    ['a capture without its time', { ...HELD, status: 'captured' }],
    ['a release without its time', { ...HELD, status: 'released' }],
    ['a held hold with a capture time', { ...HELD, capturedAt: CAPTURED_AT }],
    ['a held hold with a release time', { ...HELD, releasedAt: RELEASED_AT }],
    [
      'a capture that also reports a release',
      { ...HELD, status: 'captured', capturedAt: CAPTURED_AT, releasedAt: RELEASED_AT },
    ],
    [
      'a release that also reports a capture',
      { ...HELD, status: 'released', capturedAt: CAPTURED_AT, releasedAt: RELEASED_AT },
    ],
  ])('never guesses: %s is unknown', (_case, hold) => {
    expect(stateAt(hold, BEFORE)).toEqual({ kind: 'unknown' });
  });

  it.each([
    ['a missing hold', { clientCaptureDeadline: DEADLINE, now: BEFORE }, 'hold', 'type'],
    ['a missing deadline', { hold: HELD, now: BEFORE }, 'clientCaptureDeadline', 'required'],
    [
      'a string now',
      { hold: HELD, clientCaptureDeadline: DEADLINE, now: '2026-11-12' },
      'now',
      'type',
    ],
    [
      'an invalid deadline',
      { hold: HELD, clientCaptureDeadline: new Date(Number.NaN), now: BEFORE },
      'clientCaptureDeadline',
      'format',
    ],
  ] as const)('rejects %s', async (_case, params, field, rule) => {
    // @ts-expect-error malformed JavaScript input
    await expectInputError(() => readHoldState(params), { code: 'sdk_invalid_input', field, rule });
  });
});
