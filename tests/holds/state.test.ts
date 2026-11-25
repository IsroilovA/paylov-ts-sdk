import { describe, expect, it } from 'vitest';

import { readHoldState } from '../../src/holds/state.js';
import type { Hold } from '../../src/holds/types.js';
import type { Transaction } from '../../src/transactions/types.js';
import { expectInputError } from '../helpers/asserts.js';

// Expectations come from docs/paylov/holds.md: an expired hold keeps reading `hold`, only a
// dismiss or an expired charge moves it to `cancelled`, and a declined create leaves `check` whose
// transaction reads `failed` with `is_hold: true`.
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

const DECLINED: Hold = { ...HELD, status: 'declined' };
const FAILED: Transaction = {
  transactionId: HELD.transactionId,
  externalId: 'booking-1',
  userId: 'user-1',
  cardId: '00000000-0000-4000-8000-000000000002',
  maskedCardNumber: '860000******0000',
  amountTiyin: 100_000,
  status: 'failed',
  declineCode: 'processing_error',
  paidOrCreatedAt: BEFORE,
  cancelledAt: null,
  isHold: true,
  isSplit: false,
  isA2c: false,
  fiscalReceipts: [],
};

function stateAt(hold: Hold, now: Date, transaction?: Transaction) {
  const params = { hold, clientCaptureDeadline: DEADLINE, now };
  return readHoldState(transaction === undefined ? params : { ...params, transaction });
}

const INHERITED_HOLD: unknown = Object.assign(Object.create({ hold: HELD }), {
  clientCaptureDeadline: DEADLINE,
  now: BEFORE,
});

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

  it('reads a declined hold with its failed transaction as declined, whatever the deadline', () => {
    expect(stateAt(DECLINED, BEFORE, FAILED)).toEqual({ kind: 'declined' });
    expect(stateAt(DECLINED, DEADLINE, FAILED)).toEqual({ kind: 'declined' });
  });

  it.each<[string, Transaction | undefined]>([
    ['no transaction read', undefined],
    ['a transaction still created', { ...FAILED, status: 'created', declineCode: null }],
    ['another transaction', { ...FAILED, transactionId: '00000000-0000-4000-8000-000000000009' }],
    ['a failed transaction that is not a hold', { ...FAILED, isHold: false }],
  ])('never reads a declined hold as declined with %s', (_case, transaction) => {
    expect(stateAt(DECLINED, BEFORE, transaction)).toEqual({ kind: 'unknown' });
  });

  it('ignores an inherited transaction, which the caller never passed', () => {
    const params: unknown = Object.assign(Object.create({ transaction: FAILED }), {
      hold: DECLINED,
      clientCaptureDeadline: DEADLINE,
      now: BEFORE,
    });
    // @ts-expect-error malformed JavaScript input
    expect(readHoldState(params)).toEqual({ kind: 'unknown' });
  });

  it('decides from the one read of each parameter it validated', () => {
    const reads = { hold: 0, transaction: 0 };
    const params = {
      clientCaptureDeadline: DEADLINE,
      now: BEFORE,
      get hold(): Hold | null {
        reads.hold += 1;
        return reads.hold === 1 ? DECLINED : null;
      },
      get transaction(): Transaction | null {
        reads.transaction += 1;
        return reads.transaction === 1 ? FAILED : null;
      },
    };
    // @ts-expect-error malformed JavaScript input
    expect(readHoldState(params)).toEqual({ kind: 'declined' });
    expect(reads).toEqual({ hold: 1, transaction: 1 });
  });

  it.each<[string, Hold]>([
    ['the documented but unobserved created status', { ...HELD, status: 'created' }],
    ['a status outside the vocabulary', { ...HELD, status: 'expired' }],
    ['a capture without its time', { ...HELD, status: 'captured' }],
    ['a release without its time', { ...HELD, status: 'released' }],
    [
      'a capture whose time is an invalid Date',
      { ...HELD, status: 'captured', capturedAt: new Date(Number.NaN) },
    ],
    [
      'a release whose time is an invalid Date',
      { ...HELD, status: 'released', releasedAt: new Date(Number.NaN) },
    ],
    [
      'a capture whose amount is not money',
      { ...HELD, status: 'captured', capturedAt: CAPTURED_AT, amountTiyin: 1.5 },
    ],
    ['a held hold with a capture time', { ...HELD, capturedAt: CAPTURED_AT }],
    ['a held hold with a release time', { ...HELD, releasedAt: RELEASED_AT }],
    ['a declined hold with a capture time', { ...DECLINED, capturedAt: CAPTURED_AT }],
    ['a declined hold with a release time', { ...DECLINED, releasedAt: RELEASED_AT }],
    [
      'a capture that also reports a release',
      { ...HELD, status: 'captured', capturedAt: CAPTURED_AT, releasedAt: RELEASED_AT },
    ],
    [
      'a release that also reports a capture',
      { ...HELD, status: 'released', capturedAt: CAPTURED_AT, releasedAt: RELEASED_AT },
    ],
  ])('never guesses: %s is unknown', (_case, hold) => {
    expect(stateAt(hold, BEFORE, FAILED)).toEqual({ kind: 'unknown' });
  });

  it.each([
    ['a missing hold', { clientCaptureDeadline: DEADLINE, now: BEFORE }, 'hold', 'required'],
    ['an inherited hold', INHERITED_HOLD, 'hold', 'required'],
    ['a null hold', { hold: null, clientCaptureDeadline: DEADLINE, now: BEFORE }, 'hold', 'type'],
    [
      'a null transaction',
      { hold: DECLINED, transaction: null, clientCaptureDeadline: DEADLINE, now: BEFORE },
      'transaction',
      'type',
    ],
    ['a missing deadline', { hold: HELD, now: BEFORE }, 'clientCaptureDeadline', 'required'],
    [
      'a string now',
      { hold: HELD, clientCaptureDeadline: DEADLINE, now: '2026-11-12' },
      'now',
      'type',
    ],
    [
      'a string transaction',
      { hold: HELD, transaction: 'failed', clientCaptureDeadline: DEADLINE, now: BEFORE },
      'transaction',
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
