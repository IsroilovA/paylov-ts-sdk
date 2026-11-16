import { orOnMiss, readCall, send } from '../core/call.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import {
  decodeTransactionReference,
  readTransactionLookup,
  type TransactionReference,
} from '../shared/transactions.js';
import { decodeHold, decodeHoldCaptured } from './decoders.js';
import type {
  CaptureHoldParams,
  CreateHoldParams,
  GetHoldParams,
  Hold,
  HoldCaptured,
  ReleaseHoldParams,
} from './types.js';

export const ENDPOINTS = {
  create: { method: 'POST', route: '/merchant/payment/hold/create/', shape: 'envelope' },
  capture: { method: 'POST', route: '/merchant/payment/hold/charge/', shape: 'envelope' },
  release: { method: 'POST', route: '/merchant/payment/hold/dismiss/', shape: 'envelope' },
  get: {
    method: 'GET',
    route: '/merchant/payment/hold/status/',
    shape: 'envelope',
    miss: 'transaction_not_found',
  },
} as const;

/**
 * The `paylov.holds` namespace: reserve funds on a bound card with `create`, then either
 * `capture` them once or `release` them before the hold runs out. Paylov sends no hold webhook,
 * so reconcile open holds by polling `get`.
 */
export interface HoldsResource {
  /**
   * Reserves `amountTiyin` on a bound card for `durationMinutes`. Money is reserved, not
   * captured.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, the hold may exist. Read
   * `holds.get({ externalId })`; a hold found is the result. `null` is not proof that the
   * create did not run: read again after a delay, then call `create` again with the same
   * `externalId`. A repeat answers `external_id_already_exists` when the hold exists.
   *
   * @throws {@link PaylovApiError} `insufficient_funds` or another card decline,
   * `external_id_already_exists`, `card_not_found` (unknown or deleted card), `service_not_found`.
   *
   * @example
   * const hold = await paylov.holds.create({
   *   userId: booking.customerId,
   *   cardId: booking.cardId,
   *   amountTiyin: 150_000, // 1 500.00 SUM
   *   durationMinutes: 24 * 60,
   *   externalId: `booking-${booking.id}`,
   * });
   * await bookings.saveHold(booking.id, hold.transactionId);
   */
  create(params: CreateHoldParams, options?: PaylovCallOptions): Promise<TransactionReference>;

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
   * Releases an uncaptured hold in full; moves no money. It cannot undo a capture: after one,
   * only `payments.refund` remains, and Paylov's test environment refuses it for a captured hold
   * with `processing_error`. Release every hold you will not capture, also after its duration runs
   * out. Release is the only documented way to free a hold, so the SDK reads `hold_not_found`
   * then as nothing left to release.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `holds.get({ transactionId })`: status
   * `released` means the release took effect.
   *
   * @throws {@link PaylovApiError} `hold_not_found` (already released, captured, or expired).
   *
   * @example
   * await paylov.holds.release({ transactionId: booking.holdTransactionId });
   */
  release(params: ReleaseHoldParams, options?: PaylovCallOptions): Promise<TransactionReference>;

  /**
   * Looks a hold up by exactly one of `transactionId` or `externalId`; `null` when the gateway
   * knows no such hold (`transaction_not_found`). A miss right after an ambiguous `create` is not
   * proof: read again after a delay. An expired hold can still read `held`: track its deadline
   * (creation time plus `durationMinutes`) yourself.
   *
   * @example
   * const hold = await paylov.holds.get({ externalId: `booking-${booking.id}` });
   * if (hold === null) await retryCreateLater(booking.id);
   * else if (hold.status === 'captured') await bookings.markPaid(booking.id, hold.capturedAt);
   */
  get(params: GetHoldParams, options?: PaylovCallOptions): Promise<Hold | null>;
}

export function createHoldsResource(http: HttpClient): HoldsResource {
  return {
    async create(params, options) {
      const method = 'holds.create';
      const { input, signal } = readCall(params, options, method);
      const body = {
        userId: input.string('userId'),
        cardId: input.string('cardId'),
        amount: input.tiyinAsWholeSum('amountTiyin'),
        time: input.integer('durationMinutes'),
        externalId: input.string('externalId'),
        account: input.optionalJson('account'),
        serviceId: input.optionalString('serviceId'),
      };
      return send(http, ENDPOINTS.create, { body, signal }, decodeTransactionReference);
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
      // Which key wins when both are sent is unobserved, so the SDK never sends both.
      const query = readTransactionLookup(input);
      const hold = send(http, ENDPOINTS.get, { query, signal }, decodeHold);
      return orOnMiss(hold, ENDPOINTS.get, null);
    },
  };
}
