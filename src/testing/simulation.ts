/**
 * The opt-in gateway state behind `PaylovFakeGateway({ simulate: true })`. It encodes only
 * transitions observed on Paylov's development gateway (capture ids in the comments); any other
 * state answers `unsimulated`, which the gateway reports instead of guessing.
 */

import type { Card, DeleteCardParams, GetCardParams, ListCardsParams } from '../cards/types.js';
import type { PaylovKnownErrorCode } from '../core/errorCodes.js';
import type { PaylovFakeFailure } from '../core/fake.js';
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
/**
 * `invalid_amount` starts somewhere above 10^9 SUM and at or below 5 × 10^10 SUM (W c606, c611),
 * so only holds up to 10^9 SUM have an evidenced answer.
 */
const MAX_EVIDENCED_HOLD_TIYIN = 100_000_000_000;

/** Where a hold stands; the hold record and its transaction row both derive from it. */
type Settlement =
  | { readonly kind: 'held' }
  | {
      readonly kind: 'captured';
      readonly amountTiyin: number;
      readonly at: Date;
    }
  | {
      readonly kind: 'released';
      readonly at: Date;
      readonly by: 'dismiss' | 'expiry';
    };

/** What the simulation moved on one card; the card's reported balance never changes. */
interface CardLedger {
  /** Paid or still held: no longer on the card. */
  readonly takenTiyin: number;
  /**
   * Refunded, left uncaptured by a partial capture, or released after the hold expired: Paylov
   * gives it back on a schedule DEV did not show, so no request may rely on it.
   */
  readonly returningTiyin: number;
}

const UNTOUCHED: CardLedger = { takenTiyin: 0, returningTiyin: 0 };

interface SimulatedHold {
  readonly transactionId: string;
  readonly externalId: string;
  readonly userId: string;
  readonly cardId: string;
  readonly maskedCardNumber: string | null;
  readonly heldAmountTiyin: number;
  readonly createdAt: Date;
  readonly expiresAtMs: number;
  readonly serviceId: string;
  readonly settlement: Settlement;
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

/**
 * The hold's transaction row: `waiting` with `is_hold` and the external id (W c187); a capture
 * reports the captured amount with `date` replaced by the capture time (W c194–c197, c346); a
 * release reads `cancel` or `refunded` with the release time, `date` and `is_hold` kept (W c1276,
 * c1277, c1280, c1525, c1526, c1544).
 */
function transactionOf(hold: SimulatedHold): Transaction {
  const { settlement } = hold;
  return {
    transactionId: hold.transactionId,
    externalId: hold.externalId,
    userId: hold.userId,
    cardId: hold.cardId,
    maskedCardNumber: hold.maskedCardNumber,
    amountTiyin: settlement.kind === 'captured' ? settlement.amountTiyin : hold.heldAmountTiyin,
    status: { held: 'held', captured: 'paid', released: 'refunded' }[settlement.kind],
    declineCode: null,
    paidOrCreatedAt: settlement.kind === 'captured' ? settlement.at : hold.createdAt,
    cancelledAt: settlement.kind === 'released' ? settlement.at : null,
    isHold: true,
    isSplit: false,
    isA2c: false,
    fiscalReceipts: [],
  };
}

/** The hold's status record; a partial capture reports the captured amount (W c194). */
function holdOf(hold: SimulatedHold): Hold {
  const { settlement } = hold;
  return {
    transactionId: hold.transactionId,
    status: settlement.kind,
    amountTiyin: settlement.kind === 'captured' ? settlement.amountTiyin : hold.heldAmountTiyin,
    capturedAt: settlement.kind === 'captured' ? settlement.at : null,
    releasedAt: settlement.kind === 'released' ? settlement.at : null,
    serviceId: hold.serviceId,
  };
}

/**
 * A capture of a hold that is no longer held: refused after a capture (W c196) or a release of an
 * unexpired hold (W c201). Neither a hold released after it expired nor a second capture after
 * `hold_time_expired` was observed.
 */
function captureOfSettled(hold: SimulatedHold): SimulatedOutcome<HoldCaptured> {
  const { settlement } = hold;
  const releasedAfterExpiry =
    settlement.kind === 'released' &&
    (settlement.by === 'expiry' || settlement.at.getTime() >= hold.expiresAtMs);
  if (releasedAfterExpiry) return unsimulated('holds.capture of a hold released after it expired');
  return error('transaction_not_available_for_payment');
}

/** Each simulated SDK method takes the params its route decoded. */
export class GatewaySimulation {
  readonly #now: () => Date;
  readonly #cards = new Map<string, Card>();
  readonly #deletedCards = new Map<string, Card>();
  /** An entry per card the simulation moved funds on; balance reads of those stay unsimulated. */
  readonly #ledgers = new Map<string, CardLedger>();
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

  // Cards. Reads after a delete may still return the card for a while (W c1074–c1088), and
  // whether a read's balance reflects a charge, hold, release or refund is unobserved, so both stay
  // unsimulated.

  getCard({ cardId }: GetCardParams): SimulatedOutcome<Card> {
    if (this.#deletedCards.has(cardId)) return unsimulated('cards.get of a deleted card');
    if (this.#ledgers.has(cardId)) return unsimulated('cards.get of a charged or held card');
    const card = this.#cards.get(cardId);
    return card === undefined ? error('card_not_found') : result(card);
  }

  listCards({ userId }: ListCardsParams): SimulatedOutcome<readonly Card[]> {
    if ([...this.#deletedCards.values()].some((card) => card.userId === userId)) {
      return unsimulated('cards.list of a user with a deleted card');
    }
    const cards = [...this.#cards.values()].filter((card) => card.userId === userId);
    if (cards.some((card) => this.#ledgers.has(card.cardId))) {
      return unsimulated('cards.list of a user with a charged or held card');
    }
    return result(cards);
  }

  /** A repeated delete answers 404 `card_not_found` (W c324, c325). */
  deleteCard({ cardId }: DeleteCardParams): SimulatedOutcome<void> {
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
    // DEV paid what its test cards could cover and declined more (W c570–c585).
    const shortfall = this.#take(card, transaction.amountTiyin, 'payments.pay');
    if (shortfall !== undefined) return unsimulated(shortfall);
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
    // The refund window is agreed per merchant; DEV refunded a same-day payment (W c1579, c1580)
    // and refused 11-day-old ones (W c1562–c1568).
    if (tashkentDay(transaction.paidOrCreatedAt) !== tashkentDay(this.#now())) {
      return unsimulated('payments.refund after the Tashkent day of the payment');
    }
    // `cancel` with the refund time; `date` and the amount stay (W c111, c113). When the refunded
    // money reaches the card is unobserved.
    const refundedAt = this.#wireNow();
    if (transaction.cardId !== null) {
      this.#giveBack(transaction.cardId, transaction.amountTiyin, 'unobserved');
    }
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
    const rows = [...this.#transactions.values()].filter((transaction) => {
      const day = tashkentDay(transaction.paidOrCreatedAt);
      const isInRange =
        (fromDate === undefined || day >= fromDate) && (toDate === undefined || day <= toDate);
      return transaction.status === 'paid' && isInRange;
    });
    const paidAt = new Set(rows.map((row) => row.paidOrCreatedAt.getTime()));
    if (paidAt.size < rows.length) {
      return unsimulated(
        'transactions.list of rows paid in the same second, whose order is unobserved',
      );
    }
    const ordered = rows.toSorted(
      (a, b) => b.paidOrCreatedAt.getTime() - a.paidOrCreatedAt.getTime(),
    );
    const start = (page - 1) * LIST_PAGE_SIZE;
    // Past the end: no rows, the real total (W c153, c154).
    return result({
      total: rows.length,
      transactions: ordered.slice(start, start + LIST_PAGE_SIZE),
    });
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
    if (params.amountTiyin > MAX_EVIDENCED_HOLD_TIYIN) {
      return unsimulated('holds.create above 1 000 000 000 SUM');
    }
    // DEV held what its test cards could cover and declined more (W c600–c610).
    const shortfall = this.#take(card, params.amountTiyin, 'holds.create');
    if (shortfall !== undefined) return unsimulated(shortfall);
    const transactionId = this.#newId();
    this.#holdIdsByExternalId.set(params.externalId, transactionId);
    this.#writeHold({
      transactionId,
      externalId: params.externalId,
      userId: params.userId,
      cardId: card.cardId,
      maskedCardNumber: card.maskedCardNumber,
      heldAmountTiyin: params.amountTiyin,
      createdAt: this.#wireNow(),
      expiresAtMs: this.#now().getTime() + params.durationMinutes * MINUTE_MS,
      serviceId: SIMULATED_MERCHANT_ID, // W c184
      settlement: { kind: 'held' },
    });
    return result({ transactionId });
  }

  capture({ transactionId, amountTiyin }: CaptureHoldParams): SimulatedOutcome<HoldCaptured> {
    if (!this.#transactions.has(transactionId)) return error('transaction_not_found'); // W c192
    const hold = this.#holds.get(transactionId);
    if (hold === undefined) return error('transaction_not_available_for_payment'); // W c193
    if (hold.settlement.kind !== 'held') return captureOfSettled(hold);
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
      // Released by the failed capture (W c1276, c1277, c1280); only a dismiss is documented to
      // make the funds available again.
      this.#giveBack(hold.cardId, hold.heldAmountTiyin, 'unobserved');
      this.#writeHold({
        ...hold,
        settlement: { kind: 'released', at: this.#wireNow(), by: 'expiry' },
      });
      return error('hold_time_expired');
    }
    if (amountTiyin > hold.heldAmountTiyin) return error('invalid_amount'); // W c188
    // A partial capture ends the hold (W c194–c197); Paylov and the bank return the remainder on
    // their own schedule (M 2026-11-15).
    this.#giveBack(hold.cardId, hold.heldAmountTiyin - amountTiyin, 'unobserved');
    const capturedAt = this.#wireNow();
    this.#writeHold({
      ...hold,
      settlement: { kind: 'captured', amountTiyin, at: capturedAt },
    });
    return result({ transactionId, cardId: hold.cardId, capturedAt });
  }

  release({ transactionId }: ReleaseHoldParams): SimulatedOutcome<TransactionReference> {
    const hold = this.#holds.get(transactionId);
    if (hold === undefined)
      return unsimulated('holds.release of an unknown or non-hold transaction');
    // After a capture (W c197), a release (W c200), or an expired capture's release (W c1278).
    if (hold.settlement.kind !== 'held') return error('hold_not_found');
    if (!this.#cards.has(hold.cardId))
      return unsimulated('holds.release after the card was deleted');
    // Also after the duration ran out, without a capture attempt (W c198, c199, c1036, c1037). The
    // docs make the funds available after a dismiss (D), but say nothing about an expired hold.
    const isExpired = this.#now().getTime() >= hold.expiresAtMs;
    this.#giveBack(hold.cardId, hold.heldAmountTiyin, isExpired ? 'unobserved' : 'now');
    this.#writeHold({
      ...hold,
      settlement: { kind: 'released', at: this.#wireNow(), by: 'dismiss' },
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
    return result(holdOf(hold));
  }

  /** The one writer of a hold: its record and its transaction row change together. */
  #writeHold(hold: SimulatedHold): void {
    this.#holds.set(hold.transactionId, hold);
    this.#transactions.set(hold.transactionId, transactionOf(hold));
  }

  /**
   * Takes `amountTiyin` from what the card's balance has left, or names why the simulation cannot
   * answer: how a decline relates to the reported balance is unobserved, and so is when returning
   * funds arrive.
   */
  #take(card: Card, amountTiyin: number, method: string): string | undefined {
    const ledger = this.#ledgers.get(card.cardId) ?? UNTOUCHED;
    const left = card.balanceTiyin - ledger.takenTiyin - ledger.returningTiyin;
    if (amountTiyin > left + ledger.returningTiyin) {
      return `${method} of more than the card balance covers`;
    }
    if (amountTiyin > left) {
      return `${method} that only refunded, uncaptured or expired-hold funds would cover`;
    }
    this.#ledgers.set(card.cardId, { ...ledger, takenTiyin: ledger.takenTiyin + amountTiyin });
    return undefined;
  }

  /** Ends a charge or reservation: its funds are back on the card now or at an unobserved time. */
  #giveBack(cardId: string, amountTiyin: number, arrival: 'now' | 'unobserved'): void {
    const ledger = this.#ledgers.get(cardId) ?? UNTOUCHED;
    this.#ledgers.set(cardId, {
      takenTiyin: ledger.takenTiyin - amountTiyin,
      returningTiyin: ledger.returningTiyin + (arrival === 'now' ? 0 : amountTiyin),
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
