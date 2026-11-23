import {
  MISS,
  nullableOf,
  optionalEntry,
  utcDateTimeOf,
  decodeWholeSum,
  encodeWholeSum,
  type FakeCodec,
  type FakeRequest,
  type PaylovFakeMethod,
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
  GetHoldParams,
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

function decodeGetRequest({ query }: FakeRequest): GetHoldParams {
  return readTransactionLookup(query);
}

/**
 * The holds script. `create` replies with what the gateway sends: the SDK adds
 * `durationMinutes` and `clientCaptureDeadline` itself, from the request and its clock.
 */
export type HoldsFakeSurface = Omit<PaylovFakeSurface<HoldsResource>, 'create'> & {
  readonly create: PaylovFakeMethod<TransactionReference, CreateHoldParams>;
};

export const HOLD_CODECS: {
  readonly create: FakeCodec<TransactionReference, CreateHoldParams>;
  readonly capture: FakeCodec<HoldCaptured, CaptureHoldParams>;
  readonly release: FakeCodec<TransactionReference, ReleaseHoldParams>;
  readonly get: FakeCodec<Hold | null, GetHoldParams>;
} = {
  create: { encode: encodeTransactionReference, decodeRequest: decodeCreateRequest },
  capture: { encode: encodeHoldCaptured, decodeRequest: decodeCaptureRequest },
  release: { encode: encodeHoldReleased, decodeRequest: decodeReleaseRequest },
  get: { encode: encodeHold, decodeRequest: decodeGetRequest },
};

export function createHoldsFake(script: Scripter<'holds', HoldsResource>): HoldsFakeSurface {
  const { create, capture, release, get } = HOLD_CODECS;
  return {
    create: script('holds.create', ENDPOINTS.create, create.encode, create.decodeRequest),
    capture: script('holds.capture', ENDPOINTS.capture, capture.encode, capture.decodeRequest),
    release: script('holds.release', ENDPOINTS.release, release.encode, release.decodeRequest),
    get: script('holds.get', ENDPOINTS.get, get.encode, get.decodeRequest),
  };
}
