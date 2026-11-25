/**
 * The opt-in gateway state behind `PaylovFakeGateway({ simulate: true })`. It encodes only
 * transitions observed on Paylov's development gateway (capture ids in the comments); any other
 * state answers `unsimulated`, which the gateway reports instead of guessing.
 */

import { CARD_CODECS } from '../cards/fake.js';
import { ENDPOINTS as CARD_ENDPOINTS } from '../cards/resource.js';
import type { Card } from '../cards/types.js';
import type { PaylovKnownErrorCode } from '../core/errorCodes.js';
import type { FakeCodec, FakeRequest, PaylovFakeFailure } from '../core/fake.js';
import type { Endpoint } from '../core/types.js';
import { HOLD_CODECS } from '../holds/fake.js';
import { ENDPOINTS as HOLD_ENDPOINTS } from '../holds/resource.js';
import { PAYMENT_CODECS } from '../payments/fake.js';
import { ENDPOINTS as PAYMENT_ENDPOINTS } from '../payments/resource.js';
import { TRANSACTION_CODECS } from '../transactions/fake.js';
import { ENDPOINTS as TRANSACTION_ENDPOINTS } from '../transactions/resource.js';
import { failureAnswer, replyAnswer, type Answer } from './answers.js';
import { MINUTE_MS, TASHKENT_OFFSET_MINUTES } from '../core/time.js';
import type {
  CaptureHoldParams,
  CreateHoldParams,
  GetHoldParams,
  Hold,
  HoldCaptured,
  ReleaseHoldParams,
} from '../holds/types.js';
import type {
  CreatePaymentParams,
  PaymentRefunded,
  PayPaymentParams,
  RefundPaymentParams,
} from '../payments/types.js';
import type { TransactionReference } from '../shared/transactions.js';
import type {
  GetTransactionParams,
  ListTransactionsParams,
  Transaction,
  TransactionPage,
} from '../transactions/types.js';

/** What the simulation answers one request with. */
export type SimulatedOutcome<T> =
  | { readonly kind: 'result'; readonly value: T }
  | {
      readonly kind: 'error';
      readonly code: PaylovKnownErrorCode;
      readonly failure: PaylovFakeFailure;
    }
  | { readonly kind: 'unsimulated'; readonly reason: string };

/** The service id a hold reports when none was sent: the merchant's own id. */
const SIMULATED_MERCHANT_ID = '00000000-0000-4000-a000-00000000ffff';
/** Rows per `transactions.list` page on the development gateway (W c699–c702). */
const LIST_PAGE_SIZE = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Hold amounts below 10 SUM, durations outside 1–40320 minutes and longer external ids fail. */
const MIN_HOLD_AMOUNT_TIYIN = 1000;
const MAX_HOLD_MINUTES = 40_320;
const MAX_EXTERNAL_ID_LENGTH = 64;

interface SimulatedHold {
  readonly transactionId: string;
  readonly externalId: string;
  readonly cardId: string;
  readonly heldAmountTiyin: number;
  readonly expiresAtMs: number;
  readonly serviceId: string;
  readonly status: 'held' | 'captured' | 'released';
  readonly capturedAmountTiyin: number | null;
  readonly capturedAt: Date | null;
  readonly releasedAt: Date | null;
  readonly releasedBy: 'dismiss' | 'expiry' | null;
}

function result<T>(value: T): SimulatedOutcome<T> {
  return { kind: 'result', value };
}

function error<T>(
  code: PaylovKnownErrorCode,
  failure: PaylovFakeFailure = {},
): SimulatedOutcome<T> {
  return { kind: 'error', code, failure };
}

function unsimulated<T>(reason: string): SimulatedOutcome<T> {
  return { kind: 'unsimulated', reason };
}

/** The wire carries whole seconds. */
function wholeSeconds(ms: number): Date {
  return new Date(Math.floor(ms / 1000) * 1000);
}

/** A `YYYY-MM-DD` that names a real calendar day. */
function isCalendarDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(day);
}

/** The Tashkent calendar day of `date`, which the list filter compares (W c703, c704). */
function tashkentDay(date: Date): string {
  return new Date(date.getTime() + TASHKENT_OFFSET_MINUTES * MINUTE_MS).toISOString().slice(0, 10);
}

export class GatewaySimulation {
  readonly #now: () => Date;
  readonly #cards = new Map<string, Card>();
  readonly #deletedCards = new Map<string, Card>();
  readonly #transactions = new Map<string, Transaction>();
  readonly #holds = new Map<string, SimulatedHold>();
  readonly #holdIdsByExternalId = new Map<string, string>();
  #nextId = 1;

  constructor(now: () => Date) {
    this.#now = now;
  }

  addCard(card: Card): void {
    if (this.#cards.has(card.cardId)) throw new TypeError(`card ${card.cardId} is already bound`);
    this.#cards.set(card.cardId, card);
  }

  // Cards. Reads after a delete may still return the card for a while (W c1074–c1088), so they
  // stay unsimulated.

  getCard({ cardId }: { readonly cardId: string }): SimulatedOutcome<Card> {
    if (this.#deletedCards.has(cardId)) return unsimulated('cards.get of a deleted card');
    const card = this.#cards.get(cardId);
    return card === undefined ? error('card_not_found') : result(card);
  }

  listCards({ userId }: { readonly userId: string }): SimulatedOutcome<readonly Card[]> {
    if ([...this.#deletedCards.values()].some((card) => card.userId === userId)) {
      return unsimulated('cards.list of a user with a deleted card');
    }
    return result([...this.#cards.values()].filter((card) => card.userId === userId));
  }

  /** A repeated delete answers 404 `card_not_found` (W c324, c325). */
  deleteCard({ cardId }: { readonly cardId: string }): SimulatedOutcome<void> {
    const card = this.#cards.get(cardId);
    if (card === undefined) return error('card_not_found', { httpStatus: 404 });
    this.#cards.delete(cardId);
    this.#deletedCards.set(cardId, card);
    return result(undefined);
  }

  // Payments

  /** A new unpaid transaction with no card (W c086, c087). */
  createPayment(params: CreatePaymentParams): SimulatedOutcome<TransactionReference> {
    // Zero is `field_not_valid` (W c096); its error data is not simulated.
    if (params.amountTiyin === 0) return unsimulated('payments.create of a zero amount');
    const transactionId = this.#newId();
    this.#transactions.set(transactionId, {
      transactionId,
      externalId: null,
      userId: params.userId ?? null,
      cardId: null,
      maskedCardNumber: null,
      amountTiyin: params.amountTiyin,
      status: 'created',
      declineCode: null,
      paidOrCreatedAt: this.#wireNow(),
      cancelledAt: null,
      isHold: false,
      isSplit: false,
      isA2c: false,
      fiscalReceipts: [],
    });
    return result({ transactionId });
  }

  pay(params: PayPaymentParams): SimulatedOutcome<TransactionReference> {
    const transaction = this.#transactions.get(params.transactionId);
    if (transaction === undefined) return error('transaction_not_found'); // W c106
    if (transaction.isHold) return unsimulated('payments.pay of a hold transaction');
    if (transaction.status === 'paid') return error('transaction_already_payed'); // W c090
    if (transaction.status === 'refunded' || transaction.status === 'failed') {
      return error('transaction_not_available_for_payment'); // W c118, c632
    }
    const card = this.#cards.get(params.cardId);
    if (card === undefined) return error('card_not_found'); // W c108, c327
    if (card.userId !== params.userId) return error('card_is_not_for_this_check'); // W c109
    if (transaction.userId !== null && transaction.userId !== params.userId) {
      return unsimulated('payments.pay by a user other than the one the payment was created for');
    }
    if (!card.isActive) return unsimulated('payments.pay with an inactive card');
    // Paid, with the card attached and `date` replaced by the payment time (W c089).
    this.#transactions.set(transaction.transactionId, {
      ...transaction,
      status: 'paid',
      userId: params.userId,
      cardId: card.cardId,
      maskedCardNumber: card.maskedCardNumber,
      paidOrCreatedAt: this.#wireNow(),
    });
    return result({ transactionId: transaction.transactionId });
  }

  refund({ transactionId }: RefundPaymentParams): SimulatedOutcome<PaymentRefunded> {
    const transaction = this.#transactions.get(transactionId);
    if (transaction === undefined) return error('transaction_not_found'); // W c115
    if (transaction.isHold) return unsimulated('payments.refund of a hold transaction');
    // Already refunded (W c112) or never paid (W c114, c1272).
    if (transaction.status === 'refunded' || transaction.status === 'created') {
      return error('transaction_not_available_for_cancel');
    }
    if (transaction.status !== 'paid')
      return unsimulated(`payments.refund of a ${transaction.status} transaction`);
    // `cancel` with the refund time; `date` and the amount stay (W c111, c113).
    const refundedAt = this.#wireNow();
    this.#transactions.set(transactionId, {
      ...transaction,
      status: 'refunded',
      cancelledAt: refundedAt,
    });
    return result({ transactionId, refundedAt });
  }

  // Transactions

  /** The gateway's empty list for an unknown id reads as `transaction_not_found` (W c144). */
  getTransaction({ transactionId }: GetTransactionParams): SimulatedOutcome<Transaction> {
    const transaction = this.#transactions.get(transactionId);
    return transaction === undefined ? error('transaction_not_found') : result(transaction);
  }

  listTransactions(params: ListTransactionsParams): SimulatedOutcome<TransactionPage> {
    const { fromDate, toDate, page = 1 } = params;
    // Anything but `YYYY-MM-DD` is `field_not_valid` (W c151, c152).
    if (fromDate !== undefined && !DAY.test(fromDate))
      return error('field_not_valid', { fields: ['beginDate'] });
    if (toDate !== undefined && !DAY.test(toDate))
      return error('field_not_valid', { fields: ['endDate'] });
    if ([fromDate, toDate].some((day) => day !== undefined && !isCalendarDay(day))) {
      return unsimulated('transactions.list with a date that names no calendar day');
    }
    if (fromDate !== undefined && toDate !== undefined && fromDate > toDate) {
      return unsimulated('transactions.list with fromDate after toDate');
    }
    if (!Number.isSafeInteger(page) || page < 1)
      return error('validation_error', { fields: ['page'] }); // W c142
    // Paid rows only, newest payment first, inclusive Tashkent days (W c136, c346, c703).
    const rows = [...this.#transactions.values()]
      .filter((transaction) => transaction.status === 'paid')
      .filter((transaction) => {
        const day = tashkentDay(transaction.paidOrCreatedAt);
        return (
          (fromDate === undefined || day >= fromDate) && (toDate === undefined || day <= toDate)
        );
      })
      // Rows paid in the same second come later-created first; that order is unobserved.
      .toReversed()
      .toSorted((a, b) => b.paidOrCreatedAt.getTime() - a.paidOrCreatedAt.getTime());
    const start = (page - 1) * LIST_PAGE_SIZE;
    // Past the end: no rows, the real total (W c153, c154).
    return result({ total: rows.length, transactions: rows.slice(start, start + LIST_PAGE_SIZE) });
  }

  // Holds

  createHold(params: CreateHoldParams): SimulatedOutcome<TransactionReference> {
    const card = this.#cards.get(params.cardId);
    if (card === undefined) return error('card_not_found'); // W c207, c328
    // Unique per merchant, also after the hold was released (W c183, c1284).
    if (this.#holdIdsByExternalId.has(params.externalId))
      return error('external_id_already_exists');
    if (params.serviceId !== undefined) return unsimulated('holds.create with a serviceId');
    if (card.userId !== params.userId) return unsimulated("holds.create with another user's card");
    if (!card.isActive) return unsimulated('holds.create with an inactive card');
    // `validation_error` or `field_not_valid` (W c202–c206); their error data is not simulated.
    if (
      params.amountTiyin < MIN_HOLD_AMOUNT_TIYIN ||
      params.durationMinutes < 1 ||
      params.durationMinutes > MAX_HOLD_MINUTES ||
      params.externalId.length > MAX_EXTERNAL_ID_LENGTH
    ) {
      return unsimulated('holds.create outside the amount, duration or externalId Paylov accepts');
    }
    const transactionId = this.#newId();
    const createdAt = this.#wireNow();
    this.#holds.set(transactionId, {
      transactionId,
      externalId: params.externalId,
      cardId: card.cardId,
      heldAmountTiyin: params.amountTiyin,
      expiresAtMs: this.#now().getTime() + params.durationMinutes * MINUTE_MS,
      serviceId: SIMULATED_MERCHANT_ID, // W c184
      status: 'held',
      capturedAmountTiyin: null,
      capturedAt: null,
      releasedAt: null,
      releasedBy: null,
    });
    this.#holdIdsByExternalId.set(params.externalId, transactionId);
    // `waiting` with `is_hold` and the external id (W c187).
    this.#transactions.set(transactionId, {
      transactionId,
      externalId: params.externalId,
      userId: params.userId,
      cardId: card.cardId,
      maskedCardNumber: card.maskedCardNumber,
      amountTiyin: params.amountTiyin,
      status: 'held',
      declineCode: null,
      paidOrCreatedAt: createdAt,
      cancelledAt: null,
      isHold: true,
      isSplit: false,
      isA2c: false,
      fiscalReceipts: [],
    });
    return result({ transactionId });
  }

  capture({ transactionId, amountTiyin }: CaptureHoldParams): SimulatedOutcome<HoldCaptured> {
    const transaction = this.#transactions.get(transactionId);
    if (transaction === undefined) return error('transaction_not_found'); // W c192
    const hold = this.#holds.get(transactionId);
    if (hold === undefined) return error('transaction_not_available_for_payment'); // W c193
    if (hold.status !== 'held') return captureOfSettled(hold);
    if (!this.#cards.has(hold.cardId)) {
      return unsimulated('holds.capture after the card was deleted');
    }
    // `validation_error` below 10 SUM (W c189); its error data is not simulated.
    if (amountTiyin < MIN_HOLD_AMOUNT_TIYIN) return unsimulated('holds.capture below 10 SUM');
    const isExpired = this.#now().getTime() >= hold.expiresAtMs;
    if (isExpired && amountTiyin > hold.heldAmountTiyin) {
      return unsimulated('holds.capture of an expired hold above the held amount');
    }
    if (isExpired) {
      // Released by the failed capture: `cancelled` on status, `refunded` on the transaction,
      // both with the release time (W c1276, c1277, c1280).
      const releasedAt = this.#wireNow();
      this.#holds.set(transactionId, {
        ...hold,
        status: 'released',
        releasedAt,
        releasedBy: 'expiry',
      });
      this.#transactions.set(transactionId, {
        ...transaction,
        status: 'refunded',
        cancelledAt: releasedAt,
      });
      return error('hold_time_expired');
    }
    if (amountTiyin > hold.heldAmountTiyin) return error('invalid_amount'); // W c188
    // A partial capture ends the hold; status and the transaction report the captured amount, and
    // `date` becomes the capture time (W c194–c197, c346).
    const capturedAt = this.#wireNow();
    this.#holds.set(transactionId, {
      ...hold,
      status: 'captured',
      capturedAmountTiyin: amountTiyin,
      capturedAt,
    });
    this.#transactions.set(transactionId, {
      ...transaction,
      status: 'paid',
      amountTiyin,
      paidOrCreatedAt: capturedAt,
    });
    return result({ transactionId, cardId: hold.cardId, capturedAt });
  }

  release({ transactionId }: ReleaseHoldParams): SimulatedOutcome<TransactionReference> {
    const hold = this.#holds.get(transactionId);
    const transaction = this.#transactions.get(transactionId);
    if (hold === undefined || transaction === undefined)
      return unsimulated('holds.release of an unknown or non-hold transaction');
    // After a capture (W c197), a release (W c200), or an expired capture's release (W c1278).
    if (hold.status !== 'held') return error('hold_not_found');
    if (!this.#cards.has(hold.cardId))
      return unsimulated('holds.release after the card was deleted');
    // Also after the duration ran out, without a capture attempt (W c198, c199, c1036, c1037).
    // `cancel` on the transaction, with the release time and `is_hold` kept, before or after
    // expiry (W c1525, c1526, c1544).
    const releasedAt = this.#wireNow();
    this.#holds.set(transactionId, {
      ...hold,
      status: 'released',
      releasedAt,
      releasedBy: 'dismiss',
    });
    this.#transactions.set(transactionId, {
      ...transaction,
      status: 'refunded',
      cancelledAt: releasedAt,
    });
    return result({ transactionId });
  }

  /** Expiry alone never changes the status: an expired hold still reads `held` (W c1034, c1035). */
  getHold(lookup: GetHoldParams): SimulatedOutcome<Hold> {
    const transactionId =
      lookup.transactionId ?? this.#holdIdsByExternalId.get(lookup.externalId) ?? '';
    const hold = this.#holds.get(transactionId);
    if (hold === undefined && this.#transactions.has(transactionId)) {
      return unsimulated('holds.get of a transaction that is not a hold');
    }
    if (hold === undefined) return error('transaction_not_found'); // W c210, c211
    return result({
      transactionId: hold.transactionId,
      status: hold.status,
      amountTiyin: hold.capturedAmountTiyin ?? hold.heldAmountTiyin,
      capturedAt: hold.capturedAt,
      releasedAt: hold.releasedAt,
      serviceId: hold.serviceId,
    });
  }

  #wireNow(): Date {
    return wholeSeconds(this.#now().getTime());
  }

  #newId(): string {
    const id = `00000000-0000-4000-a000-${this.#nextId.toString(16).padStart(12, '0')}`;
    this.#nextId += 1;
    return id;
  }
}

/**
 * A capture of a hold that is no longer held: refused after a capture (W c196) or a release of an
 * unexpired hold (W c201). Neither a hold released after it expired nor a second capture after
 * `hold_time_expired` was observed.
 */
function captureOfSettled(hold: SimulatedHold): SimulatedOutcome<HoldCaptured> {
  const releasedAfterExpiry =
    hold.releasedBy === 'expiry' ||
    (hold.releasedAt !== null && hold.releasedAt.getTime() >= hold.expiresAtMs);
  if (releasedAfterExpiry) return unsimulated('holds.capture of a hold released after it expired');
  return error('transaction_not_available_for_payment');
}

/** A simulated method's answer to one request, or why the simulation has none. */
export type SimulatedAnswer =
  | { readonly kind: 'answer'; readonly answer: Answer }
  | { readonly kind: 'unsimulated'; readonly reason: string };

export type Simulator = (request: FakeRequest) => SimulatedAnswer;

function simulator<T, P>(
  endpoint: Endpoint,
  codec: FakeCodec<T, P>,
  run: (params: P) => SimulatedOutcome<T>,
): Simulator {
  return (request) => {
    const outcome = run(codec.decodeRequest(request));
    if (outcome.kind === 'unsimulated') return outcome;
    const answer =
      outcome.kind === 'error'
        ? failureAnswer(outcome.code, outcome.failure)
        : replyAnswer(endpoint, codec.encode(outcome.value));
    return { kind: 'answer', answer };
  };
}

/** The simulated SDK methods, keyed like `'holds.capture'`; every other method stays scripted. */
export function createSimulators(simulation: GatewaySimulation): ReadonlyMap<string, Simulator> {
  return new Map([
    ['cards.get', simulator(CARD_ENDPOINTS.get, CARD_CODECS.get, (p) => simulation.getCard(p))],
    [
      'cards.list',
      simulator(CARD_ENDPOINTS.list, CARD_CODECS.list, (p) => simulation.listCards(p)),
    ],
    [
      'cards.delete',
      simulator(CARD_ENDPOINTS.delete, CARD_CODECS.delete, (p) => simulation.deleteCard(p)),
    ],
    [
      'payments.create',
      simulator(PAYMENT_ENDPOINTS.create, PAYMENT_CODECS.create, (p) =>
        simulation.createPayment(p),
      ),
    ],
    [
      'payments.pay',
      simulator(PAYMENT_ENDPOINTS.pay, PAYMENT_CODECS.pay, (p) => simulation.pay(p)),
    ],
    [
      'payments.refund',
      simulator(PAYMENT_ENDPOINTS.refund, PAYMENT_CODECS.refund, (p) => simulation.refund(p)),
    ],
    [
      'transactions.get',
      simulator(TRANSACTION_ENDPOINTS.getTransactions, TRANSACTION_CODECS.get, (p) =>
        simulation.getTransaction(p),
      ),
    ],
    [
      'transactions.list',
      simulator(TRANSACTION_ENDPOINTS.getTransactions, TRANSACTION_CODECS.list, (p) =>
        simulation.listTransactions(p),
      ),
    ],
    [
      'holds.create',
      simulator(HOLD_ENDPOINTS.create, HOLD_CODECS.create, (p) => simulation.createHold(p)),
    ],
    [
      'holds.capture',
      simulator(HOLD_ENDPOINTS.capture, HOLD_CODECS.capture, (p) => simulation.capture(p)),
    ],
    [
      'holds.release',
      simulator(HOLD_ENDPOINTS.release, HOLD_CODECS.release, (p) => simulation.release(p)),
    ],
    ['holds.get', simulator(HOLD_ENDPOINTS.get, HOLD_CODECS.get, (p) => simulation.getHold(p))],
  ]);
}
