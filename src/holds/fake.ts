import {
  nullableOf,
  optionalEntry,
  utcDateTimeOf,
  decodeWholeSum,
  encodeWholeSum,
  type FakeRequest,
  type FakeSpecTable,
} from '../core/fake.js';
import { encodeStatus, encodeTransactionReference } from '../shared/fake.js';
import type { TransactionReference } from '../shared/transactions.js';
import { HOLD_STATUS_BY_WIRE } from './decoders.js';
import { ENDPOINTS, readHoldLookup, type HoldsResource } from './resource.js';
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

function encodeHold(hold: Hold): unknown {
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
  return readHoldLookup(query);
}

/**
 * `create` replies with what the gateway sends: the SDK adds `durationMinutes` and
 * `clientCaptureDeadline` itself, from the request and its clock.
 */
export interface HoldsFakeReplies {
  readonly create: TransactionReference;
}

export const HOLD_FAKES: FakeSpecTable<HoldsResource, HoldsFakeReplies> = {
  create: {
    endpoint: ENDPOINTS.create,
    encode: encodeTransactionReference,
    decodeRequest: decodeCreateRequest,
  },
  capture: {
    endpoint: ENDPOINTS.capture,
    encode: encodeHoldCaptured,
    decodeRequest: decodeCaptureRequest,
  },
  release: {
    endpoint: ENDPOINTS.release,
    encode: encodeHoldReleased,
    decodeRequest: decodeReleaseRequest,
  },
  get: {
    endpoint: ENDPOINTS.get,
    encode: encodeHold,
    decodeRequest: decodeGetRequest,
  },
};
