import {
  MISS,
  nullableOf,
  optionalEntry,
  utcDateTimeOf,
  decodeWholeSum,
  encodeWholeSum,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
import { encodeStatus, encodeTransactionReference } from '../shared/fake.js';
import { readTransactionLookup, type TransactionReference } from '../shared/transactions.js';
import { HOLD_STATUS_BY_WIRE } from './decoders.js';
import { ENDPOINTS, type HoldsResource } from './resource.js';
import type {
  CaptureHoldParams,
  CreateHoldParams,
  Hold,
  HoldCaptured,
  ReleaseHoldParams,
} from './types.js';

function encodeHoldCaptured(captured: HoldCaptured): unknown {
  return {
    ...encodeTransactionReference(captured),
    cardId: captured.cardId,
    payedAt: utcDateTimeOf(captured.capturedAt, 'capturedAt'),
  };
}

function encodeHoldReleased(released: TransactionReference): unknown {
  return { ...encodeTransactionReference(released), status: 'cancelled' };
}

function encodeHold(hold: Hold | null): unknown {
  if (hold === null) return MISS;
  return {
    transactionId: hold.transactionId,
    status: encodeStatus(HOLD_STATUS_BY_WIRE, hold.status),
    amount: encodeWholeSum(hold.amountTiyin, 'amountTiyin'),
    payedAt: nullableOf(hold.capturedAt, (date) => utcDateTimeOf(date, 'capturedAt')),
    cancelTime: nullableOf(hold.releasedAt, (date) => utcDateTimeOf(date, 'releasedAt')),
    serviceId: hold.serviceId,
  };
}

function decodeCreateRequest({ body }: FakeRequest): CreateHoldParams {
  return {
    userId: body.string('userId'),
    cardId: body.string('cardId'),
    amountTiyin: decodeWholeSum(body, 'amount'),
    durationMinutes: body.integer('time'),
    externalId: body.string('externalId'),
    ...optionalEntry('account', body.optionalJson('account')),
    ...optionalEntry('serviceId', body.optionalString('serviceId')),
  };
}

function decodeCaptureRequest({ body }: FakeRequest): CaptureHoldParams {
  return {
    transactionId: body.string('transactionId'),
    amountTiyin: decodeWholeSum(body, 'amount'),
  };
}

function decodeReleaseRequest({ body }: FakeRequest): ReleaseHoldParams {
  return { transactionId: body.string('transactionId') };
}

export function createHoldsFake(
  script: Scripter<'holds', HoldsResource>,
): PaylovFakeSurface<HoldsResource> {
  return {
    create: script(
      'holds.create',
      ENDPOINTS.create,
      encodeTransactionReference,
      decodeCreateRequest,
    ),
    capture: script('holds.capture', ENDPOINTS.capture, encodeHoldCaptured, decodeCaptureRequest),
    release: script('holds.release', ENDPOINTS.release, encodeHoldReleased, decodeReleaseRequest),
    get: script('holds.get', ENDPOINTS.get, encodeHold, ({ query }) =>
      readTransactionLookup(query),
    ),
  };
}
