import { readCall, send } from '../core/call.js';
import { MINUTE_MS, readClock, type Clock } from '../core/time.js';
import type { Params } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { decodeTransactionReference, type TransactionReference } from '../shared/transactions.js';
import { decodeHold, decodeHoldCaptured } from './decoders.js';
import type {
  CaptureHoldParams,
  CreateHoldParams,
  GetHoldParams,
  Hold,
  HoldCaptured,
  HoldCreated,
  ReleaseHoldParams,
} from './types.js';

export const ENDPOINTS = {
  create: {
    method: 'POST',
    route: '/merchant/payment/hold/create/',
    shape: 'envelope',
    effect: 'money',
  },
  capture: {
    method: 'POST',
    route: '/merchant/payment/hold/charge/',
    shape: 'envelope',
    effect: 'money',
  },
  release: {
    method: 'POST',
    route: '/merchant/payment/hold/dismiss/',
    shape: 'envelope',
    effect: 'money',
  },
  get: {
    method: 'GET',
    route: '/merchant/payment/hold/status/',
    shape: 'envelope',
    effect: 'read',
  },
} as const;

/**
 * The `paylov.holds` namespace: reserve funds on a bound card with `create`, then either
 * `capture` them once or `release` them before the hold runs out. Paylov documents no hold
 * webhook, so reconcile open holds by polling `get`.
 */
export interface HoldsResource {
  /**
   * Reserves `amountTiyin` on a bound card for `durationMinutes`. Money is reserved, not
   * captured. Store `clientCaptureDeadline`, a conservative client-side cut-off: Paylov reports no
   * expiry, and an expired hold still reads `held`.
   *
   * A create that leaves a record uses up its `externalId`, a declined one too: the declined
   * record reads `declined` in `holds.get`, and a new create with that id answers
   * `external_id_already_exists`. A create the gateway rejects for its Bearer token leaves no
   * record. Only a new attempt after a confirmed decline or a release takes a new `externalId`.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, the hold may exist, even after an abort. Read
   * `holds.get({ externalId })` after a backoff and pass the record to `readHoldState`, with the
   * `transactions.get` read of a `declined` record: only a `held` record is the hold, and only the
   * `declined` state allows a new attempt with a new `externalId`. `transaction_not_found` right
   * after the failure proves nothing: read again after a backoff, then call `create` again with the
   * same stored `externalId`, never a new one. A repeat answers `external_id_already_exists` when a
   * record exists: read it again.
   *
   * @throws {@link PaylovApiError} `insufficient_funds` or another card decline,
   * `external_id_already_exists` (a hold, released or declined, has this id), `card_not_found`
   * (unknown or deleted card), `service_not_found`.
   *
   * @example
   * const hold = await paylov.holds.create({
   *   userId: booking.customerId,
   *   cardId: booking.cardId,
   *   amountTiyin: 150_000, // 1 500.00 SUM
   *   durationMinutes: 24 * 60,
   *   externalId: booking.holdExternalId, // stored before the call, reused on an ambiguous replay
   * });
   * await bookings.saveHold(booking.id, hold.transactionId, hold.clientCaptureDeadline);
   */
  create(params: CreateHoldParams, options?: PaylovCallOptions): Promise<HoldCreated>;

  /**
   * Captures a hold: **this moves money.** Capture is single-use. An amount below the held
   * amount is a partial capture and ends the hold: the remainder can be neither captured nor
   * released afterwards. Paylov does not document what happens to it; the SDK assumes Paylov and
   * the card's bank return it to the cardholder. After the hold's duration runs out, capture fails
   * with `hold_time_expired`, and Paylov's test environment then reported the hold `released`.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `holds.get({ transactionId })` before
   * anything else: `captured` means the capture happened and `amountTiyin` is the captured amount.
   * Never capture again blindly; a repeat answers `transaction_not_available_for_payment` once
   * the hold is captured or released.
   *
   * @throws {@link PaylovApiError} `invalid_amount` (more than the held amount),
   * `transaction_not_available_for_payment` (already captured, released, or not a hold),
   * `hold_time_expired`, `transaction_not_found`.
   *
   * @example
   * const captured = await paylov.holds.capture({
   *   transactionId: booking.holdTransactionId,
   *   amountTiyin: 150_000,
   * });
   * await bookings.markPaid(booking.id, captured.capturedAt);
   */
  capture(params: CaptureHoldParams, options?: PaylovCallOptions): Promise<HoldCaptured>;

  /**
   * Releases an uncaptured hold in full, returning the reserved money to the card. It cannot undo a
   * capture: after one, only `payments.refund` remains. Paylov states captured holds are
   * refundable, but its test environment refused them with `processing_error`, which the SDK
   * reports as an unknown outcome.
   * Release every hold you will not capture, also after its duration runs out: expiry alone has
   * not been seen to free a hold, and a release after expiry has succeeded. `hold_not_found` after
   * expiry has been seen only after a capture attempt failed with `hold_time_expired`, which itself
   * left the hold `released`.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `holds.get({ transactionId })` and pass it
   * to `readHoldState`: `released` is the hold's current state at the gateway, not proof of which
   * call released it or of when the funds reach the cardholder.
   *
   * @throws {@link PaylovApiError} `hold_not_found` (already released or captured).
   *
   * @example
   * await paylov.holds.release({ transactionId: booking.holdTransactionId });
   */
  release(params: ReleaseHoldParams, options?: PaylovCallOptions): Promise<TransactionReference>;

  /**
   * Looks a hold up by exactly one of `transactionId` or `externalId`. Moves no money. A declined
   * create also leaves a record, `declined`; its `transactions.get` read `failed` confirms the
   * decline. An expired hold can still read `held`: compare `now` with the `clientCaptureDeadline`
   * from `holds.create`, or pass both to `readHoldState`.
   *
   * @throws {@link PaylovApiError} `transaction_not_found` when the gateway knows no such hold.
   * Right after an ambiguous `create` it is not proof that the create did not run: read again
   * after a delay.
   *
   * @example
   * const hold = await paylov.holds.get({ externalId: booking.holdExternalId });
   * if (hold.status === 'captured') await bookings.markPaid(booking.id, hold.capturedAt);
   */
  get(params: GetHoldParams, options?: PaylovCallOptions): Promise<Hold>;
}

export function createHoldsResource(http: HttpClient, clock: Clock): HoldsResource {
  return {
    async create(params, options) {
      const method = 'holds.create';
      const { input, signal } = readCall(params, options, method);
      const durationMinutes = input.integer('durationMinutes');
      const body = {
        userId: input.string('userId'),
        cardId: input.string('cardId'),
        amount: input.tiyinAsWholeSum('amountTiyin'),
        time: durationMinutes,
        externalId: input.string('externalId'),
        account: input.optionalJson('account'),
        serviceId: input.optionalString('serviceId'),
      };
      // Read before the request leaves: a conservative cut-off, assuming a consistent client clock;
      // Paylov's timer origin is not established (docs/paylov/holds.md#flow).
      const startedAt = readClock(clock, method);
      const { transactionId } = await send(
        http,
        ENDPOINTS.create,
        { body, signal },
        decodeTransactionReference,
      );
      const clientCaptureDeadline = new Date(startedAt + durationMinutes * MINUTE_MS);
      return { transactionId, durationMinutes, clientCaptureDeadline };
    },

    async capture(params, options) {
      const method = 'holds.capture';
      const { input, signal } = readCall(params, options, method);
      const body = {
        transactionId: input.string('transactionId'),
        amount: input.tiyinAsWholeSum('amountTiyin'),
      };
      return send(http, ENDPOINTS.capture, { body, signal }, decodeHoldCaptured);
    },

    async release(params, options) {
      const method = 'holds.release';
      const { input, signal } = readCall(params, options, method);
      const body = { transactionId: input.string('transactionId') };
      return send(http, ENDPOINTS.release, { body, signal }, decodeTransactionReference);
    },

    async get(params, options) {
      const method = 'holds.get';
      const { input, signal } = readCall(params, options, method);
      // Paylov's answer to both keys is unobserved (docs/paylov/holds.md#status): send only one.
      const query = readHoldLookup(input);
      return send(http, ENDPOINTS.get, { query, signal }, decodeHold);
    },
  };
}

/** Reads exactly one of `transactionId` or `externalId`; the result carries only the key given. */
export function readHoldLookup(input: Params): GetHoldParams {
  return input.exclusive(['transactionId', 'externalId']) === 'transactionId'
    ? { transactionId: input.string('transactionId') }
    : { externalId: input.string('externalId') };
}
