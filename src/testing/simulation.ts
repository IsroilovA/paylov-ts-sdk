/**
 * The opt-in gateway state behind `PaylovFakeGateway({ simulate: true })` and the simulator
 * server. It encodes only transitions observed on Paylov's development gateway (capture ids in the
 * comments) or documented by Paylov; any other state answers `unsimulated`, which the gateway
 * reports instead of guessing.
 */

import type {
  Card,
  ConfirmPanBindingParams,
  DeleteCardParams,
  GetCardParams,
  ListCardsParams,
  PanBindingStarted,
  StartPanBindingParams,
} from '../cards/types.js';
import { isUuid } from '../core/decoding.js';
import type { PaylovKnownErrorCode } from '../core/errorCodes.js';
import { tashkentDateTimeOf, type PaylovFakeFailure } from '../core/fake.js';
import { MINUTE_MS, TASHKENT_OFFSET_MINUTES } from '../core/time.js';
import type {
  FiscalReceiptRefunded,
  GetFiscalReceiptParams,
  RefundFiscalReceiptParams,
  RegisterFiscalReceiptParams,
} from '../fiscalization/types.js';
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
import type { FiscalReceipt, FiscalReceiptRegistered } from '../shared/fiscalReceipts.js';
import type { FiscalReceiptItem } from '../shared/receiptItems.js';
import type { TransactionReference } from '../shared/transactions.js';
import { withWireStatus } from '../transactions/fake.js';
import type {
  FiscalReceiptSummary,
  GetTransactionParams,
  ListTransactionsParams,
  Transaction,
  TransactionPage,
} from '../transactions/types.js';
import { isCardExpiry, isLuhnValid, maskCardNumber, maskPhone, type PanCard } from './panCards.js';
import {
  emptySimulationState,
  type CardLedger,
  type IssuedReceipt,
  type PanBinding,
  type SimulatedCard,
  type SimulatedHold,
  type SimulatedSale,
  type SimulationState,
  type TransactionReceipts,
} from './simulationState.js';

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
/** `receipts/create` was approved up to at least 10^10 SUM (W c103); above that is unobserved. */
const MAX_EVIDENCED_PAYMENT_TIYIN = 1_000_000_000_000;
/** Every spelling of a UUID carries 32 hex digits. */
const UUID_HEX_DIGITS = 32;
/** `createUserCard/` refused a card number under 16 characters (W c035). */
const MIN_CARD_NUMBER_LENGTH = 16;
/** A binding OTP confirmed up to 89.6 s and expired from 91.6 s after it was sent (W c784–c791). */
const OTP_CONFIRMED_UNTIL_MS = 89_600;
const OTP_EXPIRED_FROM_MS = 91_600;
/**
 * A repeated binding answered `otp_code_already_sent` up to 80.6 s and a new OTP from 96.6 s after
 * the first was sent (W c741, c844, c855, c810).
 */
const OTP_RESEND_REFUSED_UNTIL_MS = 80_600;
const OTP_RESEND_ALLOWED_FROM_MS = 96_600;
/** Wrong OTPs 1 to 3 answer `invalid_otp`; the 4th blocks the card for minutes (W c934–c937). */
const MAX_SIMULATED_WRONG_OTPS = 3;
/** The receipt fields the simulated OFD fills in; not a real terminal. */
const SIMULATED_TERMINAL_ID = 'EP000000000001';

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

/**
 * The answer to a transaction id the simulation holds nothing for: `missing` for a canonical UUID;
 * for an id with too few hex digits to be any UUID, the recorded `validation_error` on
 * `transactionId` where `refusesNonUuid`; otherwise unsimulated, since which other UUID spellings
 * Paylov accepts is unobserved.
 */
function unknownTransaction<T>(
  transactionId: string,
  method: string,
  missing: SimulatedOutcome<T>,
  refusesNonUuid: boolean,
): SimulatedOutcome<T> {
  const hexDigits = transactionId.replaceAll(/[^0-9a-f]/gi, '').length;
  if (isUuid(transactionId)) return missing;
  if (refusesNonUuid && hexDigits < UUID_HEX_DIGITS) {
    return error('validation_error', { fields: ['transactionId'] });
  }
  return unsimulated(`${method} of a transaction id that is not a canonical UUID`);
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

/** How a transaction row lists a receipt. */
function summaryOf(receipt: IssuedReceipt, isRefund: boolean): FiscalReceiptSummary {
  const { receiptId, receiptUrl, issuedAt } = receipt;
  return { receiptId, receiptUrl, issuedAt, isRefund };
}

function fiscalReceiptOf(receipt: IssuedReceipt, isRefund: boolean): FiscalReceipt {
  const { receiptId, receiptUrl, terminalId, fiscalSign } = receipt;
  return { receiptId, receiptUrl, terminalId, fiscalSign, isRefund };
}

function registeredOf({
  receiptId,
  receiptUrl,
  terminalId,
  fiscalSign,
}: IssuedReceipt): FiscalReceiptRegistered {
  return { receiptId, receiptUrl, terminalId, fiscalSign };
}

/**
 * What one item line adds to the receipt total, `(price - discount) * count` (M 2026-11-16), or
 * `undefined` for a discount above the price, which Paylov refuses with a code it does not name.
 */
function lineTotalTiyin(item: FiscalReceiptItem): number | undefined {
  const discountTiyin = item.discountTiyin ?? 0;
  if (discountTiyin > item.priceTiyin) return undefined;
  return (item.priceTiyin - discountTiyin) * item.count;
}

/**
 * The hold's transaction row: `waiting` with `is_hold` and the external id (W c187); a capture
 * reports the captured amount with `date` replaced by the capture time (W c194–c197, c346); a
 * release keeps `date` and `is_hold` and adds the release time, reading `cancel` after a dismiss,
 * also of an expired hold (W c1525, c1526, c1544), and `refunded` after the release a failed
 * expired capture caused (W c1276, c1277, c1280).
 */
function transactionOf(
  hold: SimulatedHold,
  fiscalReceipts: readonly FiscalReceiptSummary[],
): Transaction {
  const { settlement } = hold;
  const transaction: Transaction = {
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
    fiscalReceipts,
  };
  if (settlement.kind !== 'released') return transaction;
  return withWireStatus(transaction, settlement.by === 'expiry' ? 'refunded' : 'cancel');
}

/** A payment's row: unpaid without a card (W c086, c087), then paid or refunded. */
function saleTransactionOf(
  sale: SimulatedSale,
  fiscalReceipts: readonly FiscalReceiptSummary[],
): Transaction {
  return {
    transactionId: sale.transactionId,
    externalId: null,
    userId: sale.userId,
    cardId: sale.cardId,
    maskedCardNumber: sale.maskedCardNumber,
    amountTiyin: sale.amountTiyin,
    status: sale.status,
    declineCode: null,
    paidOrCreatedAt: sale.paidOrCreatedAt,
    cancelledAt: sale.refundedAt,
    isHold: false,
    isSplit: false,
    isA2c: false,
    fiscalReceipts,
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
  if (settlement.kind === 'released' && settlement.wasExpired) {
    return unsimulated('holds.capture of a hold released after it expired');
  }
  return error('transaction_not_available_for_payment');
}

/** The refund receipt as reads show it at `nowMs`: `unknown` when the test chose no delay. */
function visibleRefund(
  receipts: TransactionReceipts,
  nowMs: number,
): IssuedReceipt | null | 'unknown' {
  const { refund } = receipts;
  if (refund === undefined) return null;
  if (refund.visibleAt === null) return 'unknown';
  return nowMs >= refund.visibleAt.getTime() ? refund.receipt : null;
}

/** The answers the test chooses, since Paylov's depend on the merchant or are not pinned down. */
export interface SimulationSettings {
  readonly now: () => Date;
  /** Unset: every refund of a paid sale is unsimulated. */
  readonly refundWindowMinutes: number | undefined;
  /** Unset: every read of a refund receipt a refund registered is unsimulated. */
  readonly refundReceiptDelaySeconds: number | undefined;
}

/** Each simulated SDK method takes the params its route decoded. */
export class GatewaySimulation {
  /** What the simulator server persists; only this class changes it. */
  readonly state: SimulationState;
  readonly #now: () => Date;
  readonly #refundWindowMinutes: number | undefined;
  readonly #refundReceiptDelaySeconds: number | undefined;
  readonly #holdIdsByExternalId = new Map<string, string>();
  /** The cards PAN bindings can bind, by masked number; configuration, never state. */
  readonly #panCards = new Map<string, PanCard>();

  constructor(settings: SimulationSettings, state: SimulationState = emptySimulationState()) {
    this.#now = settings.now;
    this.#refundWindowMinutes = settings.refundWindowMinutes;
    this.#refundReceiptDelaySeconds = settings.refundReceiptDelaySeconds;
    this.state = state;
    for (const hold of state.holds.values()) {
      this.#holdIdsByExternalId.set(hold.externalId, hold.transactionId);
    }
  }

  /**
   * A deleted id stays deleted: what Paylov answers for a card bound again under the same id is
   * unobserved, and its reads stay unsimulated (W c326, c1074–c1088).
   */
  addCard(card: Card, spendableTiyin: number | undefined): void {
    const known = this.state.cards.get(card.cardId);
    if (known?.isDeleted === true) {
      throw new TypeError(`card ${card.cardId} was deleted; bind a new card with a fresh cardId`);
    }
    if (known !== undefined || this.state.bindings.has(card.cardId)) {
      throw new TypeError(`card ${card.cardId} is already bound`);
    }
    this.state.cards.set(card.cardId, {
      card,
      spendableTiyin,
      ledger: undefined,
      isDeleted: false,
    });
  }

  addPanCard(panCard: PanCard): void {
    if (this.#panCards.has(panCard.maskedCardNumber)) {
      throw new TypeError(
        `two PAN cards share the masked number ${panCard.maskedCardNumber}; vary their first six or last four digits`,
      );
    }
    this.#panCards.set(panCard.maskedCardNumber, panCard);
  }

  // PAN binding. Only the answers recorded on DEV are simulated; the order of two checks that
  // both fail is unobserved, so such a request is unsimulated.

  startPanBinding(params: StartPanBindingParams): SimulatedOutcome<PanBindingStarted> {
    const { userId, cardNumber, cardExpiry, phoneNumber } = params;
    if (cardNumber.length < MIN_CARD_NUMBER_LENGTH) {
      return unsimulated('cards.startPanBinding of a card number under 16 characters');
    }
    if (!isCardExpiry(cardExpiry)) return error('validation_error', { fields: ['expireDate'] }); // W c031, c033
    if (!/^\d+$/.test(cardNumber)) {
      return unsimulated('cards.startPanBinding of a card number that is not all digits');
    }
    if (!isLuhnValid(cardNumber)) return error('card_not_found', { httpStatus: 404 }); // W c034
    const panCard = this.#panCards.get(maskCardNumber(cardNumber));
    if (panCard?.cardNumber !== cardNumber) {
      return unsimulated('cards.startPanBinding of a card number the simulation was not given');
    }
    const mismatch = this.#bindingMismatch(panCard, cardExpiry, phoneNumber);
    if (mismatch !== undefined) return mismatch;
    if (this.#activeBinding(userId, panCard.maskedCardNumber) !== undefined) {
      return error('card_exists'); // W c030
    }
    const otpSentPhone = maskPhone(panCard.phoneNumber);
    const pending = this.#pendingBinding(userId, panCard.maskedCardNumber);
    if (pending !== undefined) return this.#resendOtp(pending, otpSentPhone);
    const cardId = this.#newId();
    this.state.bindings.set(cardId, {
      cardId,
      userId,
      maskedCardNumber: panCard.maskedCardNumber,
      otpSentAt: this.#now(),
      wrongOtps: 0,
      isConfirmed: false,
    });
    return result({ cardId, otpSentPhone });
  }

  confirmPanBinding(params: ConfirmPanBindingParams): SimulatedOutcome<Card> {
    const { cardId, otp, pinfl } = params;
    if (!isUuid(cardId)) {
      return unsimulated('cards.confirmPanBinding of a cardId that is not a UUID');
    }
    const binding = this.state.bindings.get(cardId);
    if (binding === undefined) {
      return this.state.cards.has(cardId)
        ? unsimulated('cards.confirmPanBinding of a card added without a PAN binding')
        : error('card_not_found', { httpStatus: 404 }); // W c048
    }
    if (binding.isConfirmed) {
      return this.state.cards.get(cardId)?.isDeleted === true
        ? unsimulated('cards.confirmPanBinding of a deleted card')
        : error('card_is_already_activated', { httpStatus: 404 }); // W c028
    }
    const panCard = this.#panCards.get(binding.maskedCardNumber);
    if (panCard === undefined) {
      return unsimulated('cards.confirmPanBinding of a card no longer among the PAN cards');
    }
    if (binding.wrongOtps >= MAX_SIMULATED_WRONG_OTPS) {
      return unsimulated(
        'cards.confirmPanBinding after three wrong OTPs, when Paylov blocks the card',
      );
    }
    const isOtpRight = otp === panCard.otp;
    const elapsedMs = this.#now().getTime() - binding.otpSentAt.getTime();
    if (elapsedMs > OTP_CONFIRMED_UNTIL_MS) {
      return elapsedMs >= OTP_EXPIRED_FROM_MS && isOtpRight
        ? error('otp_expired') // W c788
        : unsimulated('cards.confirmPanBinding about 90 s after the OTP or with a wrong OTP late');
    }
    const pinflMismatch = this.#pinflMismatch(panCard, pinfl, isOtpRight);
    if (pinflMismatch !== undefined) return pinflMismatch;
    // A wrong code leaves the OTP usable (W c026–c029, c934–c936).
    if (!isOtpRight) {
      this.state.bindings.set(cardId, { ...binding, wrongOtps: binding.wrongOtps + 1 });
      return error('invalid_otp');
    }
    const card = this.#cardOf(binding, panCard, params.cardName);
    this.state.bindings.set(cardId, { ...binding, isConfirmed: true });
    this.state.cards.set(cardId, {
      card,
      spendableTiyin: panCard.spendableTiyin,
      ledger: undefined,
      isDeleted: false,
    });
    return result(card);
  }

  /** `card_not_match` for a wrong expiry (W c032), `phone_not_match` for a wrong phone (W c041). */
  #bindingMismatch(
    panCard: PanCard,
    cardExpiry: string,
    phoneNumber: string | undefined,
  ): SimulatedOutcome<PanBindingStarted> | undefined {
    if (phoneNumber !== undefined && panCard.phoneNumber === undefined) {
      return unsimulated('cards.startPanBinding with a phoneNumber for a card given without one');
    }
    const isExpiryWrong = cardExpiry !== panCard.cardExpiry;
    const isPhoneWrong = phoneNumber !== undefined && phoneNumber !== panCard.phoneNumber;
    if (isExpiryWrong && isPhoneWrong) {
      return unsimulated('cards.startPanBinding with both a wrong expiry and a wrong phone');
    }
    if (isExpiryWrong) return error('card_not_match');
    if (isPhoneWrong) return error('phone_not_match');
    return undefined;
  }

  /**
   * While the OTP is valid a repeat answers `otp_code_already_sent` (W c741, c744, c839, c844);
   * after it expired the same `cid` gets a new OTP (W c855, c857, c810, c811).
   */
  #resendOtp(pending: PanBinding, otpSentPhone: string): SimulatedOutcome<PanBindingStarted> {
    const now = this.#now();
    const elapsedMs = now.getTime() - pending.otpSentAt.getTime();
    if (elapsedMs <= OTP_RESEND_REFUSED_UNTIL_MS) return error('otp_code_already_sent');
    if (elapsedMs < OTP_RESEND_ALLOWED_FROM_MS) {
      return unsimulated('a repeated cards.startPanBinding between 80.6 and 96.6 s after the OTP');
    }
    if (pending.wrongOtps > 0) {
      return unsimulated('a repeated cards.startPanBinding after a wrong OTP');
    }
    this.state.bindings.set(pending.cardId, { ...pending, otpSentAt: now });
    return result({ cardId: pending.cardId, otpSentPhone });
  }

  /** `pinfl_not_match` for another cardholder's PINFL, leaving the OTP usable (W c049). */
  #pinflMismatch(
    panCard: PanCard,
    pinfl: string | undefined,
    isOtpRight: boolean,
  ): SimulatedOutcome<Card> | undefined {
    if (pinfl === undefined) return undefined;
    if (pinfl.length !== panCard.pinfl?.length) {
      return unsimulated(
        'cards.confirmPanBinding with a pinfl for a card given without one, or not 14 characters',
      );
    }
    if (pinfl === panCard.pinfl) return undefined;
    return isOtpRight
      ? error('pinfl_not_match')
      : unsimulated('cards.confirmPanBinding with both a wrong OTP and a wrong pinfl');
  }

  /** The confirmed card, active with SMS enabled as every observed confirm (W c027, c045). */
  #cardOf(binding: PanBinding, panCard: PanCard, cardName: string | undefined): Card {
    return {
      ...panCard.details,
      cardId: binding.cardId,
      userId: binding.userId,
      cardName: cardName === undefined || cardName === '' ? null : cardName,
      maskedCardNumber: panCard.maskedCardNumber,
      isActive: true,
      processingStatus: 'active',
      isSmsEnabled: true,
    };
  }

  #activeBinding(userId: string, maskedCardNumber: string): PanBinding | undefined {
    return [...this.state.bindings.values()].find(
      (binding) =>
        binding.isConfirmed &&
        binding.userId === userId &&
        binding.maskedCardNumber === maskedCardNumber &&
        this.state.cards.get(binding.cardId)?.isDeleted === false,
    );
  }

  #pendingBinding(userId: string, maskedCardNumber: string): PanBinding | undefined {
    return [...this.state.bindings.values()].find(
      (binding) =>
        !binding.isConfirmed &&
        binding.userId === userId &&
        binding.maskedCardNumber === maskedCardNumber,
    );
  }

  #isPendingBinding(cardId: string): boolean {
    return this.state.bindings.get(cardId)?.isConfirmed === false;
  }

  // Cards. Reads after a delete may still return the card for a while (W c1074–c1088), and
  // whether a read's balance reflects a charge, hold, release or refund is unobserved, so both stay
  // unsimulated.

  getCard({ cardId }: GetCardParams): SimulatedOutcome<Card> {
    const known = this.state.cards.get(cardId);
    if (known?.isDeleted === true) return unsimulated('cards.get of a deleted card');
    if (known?.ledger !== undefined) return unsimulated('cards.get of a charged or held card');
    if (this.#isPendingBinding(cardId)) return unsimulated('cards.get of an unconfirmed binding');
    return known === undefined ? error('card_not_found') : result(known.card);
  }

  listCards({ userId }: ListCardsParams): SimulatedOutcome<readonly Card[]> {
    const owned = [...this.state.cards.values()].filter(({ card }) => card.userId === userId);
    if (owned.some(({ isDeleted }) => isDeleted)) {
      return unsimulated('cards.list of a user with a deleted card');
    }
    if (owned.some(({ ledger }) => ledger !== undefined)) {
      return unsimulated('cards.list of a user with a charged or held card');
    }
    return result(owned.map(({ card }) => card));
  }

  /**
   * A repeated delete answers 404 `card_not_found` (W c324, c325). An unconfirmed binding can be
   * deleted (W c719–c721), with an answer the captures do not show.
   */
  deleteCard({ cardId }: DeleteCardParams): SimulatedOutcome<void> {
    const known = this.state.cards.get(cardId);
    if (known === undefined || known.isDeleted) {
      return this.#isPendingBinding(cardId)
        ? unsimulated('cards.delete of an unconfirmed binding')
        : error('card_not_found', { httpStatus: 404 });
    }
    this.state.cards.set(cardId, { ...known, isDeleted: true });
    return result(undefined);
  }

  // Payments

  /** A new unpaid transaction with no card (W c086, c087). */
  createPayment(params: CreatePaymentParams): SimulatedOutcome<TransactionReference> {
    if (params.amountTiyin === 0) return error('field_not_valid', { fields: ['amount'] }); // W c096
    if (params.amountTiyin > MAX_EVIDENCED_PAYMENT_TIYIN) {
      return unsimulated('payments.create above 10 000 000 000 SUM');
    }
    const transactionId = this.#newId();
    this.state.sales.set(transactionId, {
      transactionId,
      userId: params.userId ?? null,
      cardId: null,
      maskedCardNumber: null,
      amountTiyin: params.amountTiyin,
      status: 'created',
      paidOrCreatedAt: this.#wireNow(),
      refundedAt: null,
    });
    return result({ transactionId });
  }

  pay(params: PayPaymentParams): SimulatedOutcome<TransactionReference> {
    const sale = this.state.sales.get(params.transactionId);
    if (sale === undefined) {
      if (this.state.holds.has(params.transactionId)) {
        return unsimulated('payments.pay of a hold transaction');
      }
      // W c106, c107
      return unknownTransaction(
        params.transactionId,
        'payments.pay',
        error('transaction_not_found'),
        true,
      );
    }
    if (sale.status === 'paid') return error('transaction_already_payed'); // W c090
    if (sale.status === 'refunded') return error('transaction_not_available_for_payment'); // W c118
    const known = this.state.cards.get(params.cardId);
    if (known === undefined || known.isDeleted) return error('card_not_found'); // W c108, c327
    const { card } = known;
    if (card.userId !== params.userId) return error('card_is_not_for_this_check'); // W c109
    if (sale.userId !== null && sale.userId !== params.userId) {
      return unsimulated('payments.pay by a user other than the one the payment was created for');
    }
    if (!card.isActive) return unsimulated('payments.pay with an inactive card');
    // DEV paid small amounts and declined larger ones on the same card (W c570–c585, c615).
    const shortfall = this.#take(known, sale.amountTiyin, 'payments.pay');
    if (shortfall !== undefined) return unsimulated(shortfall);
    // Paid, with the card attached and `date` replaced by the payment time (W c089).
    this.state.sales.set(sale.transactionId, {
      ...sale,
      status: 'paid',
      userId: params.userId,
      cardId: card.cardId,
      maskedCardNumber: card.maskedCardNumber,
      paidOrCreatedAt: this.#wireNow(),
    });
    return result({ transactionId: sale.transactionId });
  }

  refund({ transactionId }: RefundPaymentParams): SimulatedOutcome<PaymentRefunded> {
    const sale = this.state.sales.get(transactionId);
    if (sale === undefined) {
      if (this.state.holds.has(transactionId)) {
        return unsimulated('payments.refund of a hold transaction');
      }
      // W c115, c116
      return unknownTransaction(
        transactionId,
        'payments.refund',
        error('transaction_not_found'),
        true,
      );
    }
    // Already refunded (W c112) or never paid (W c114, c1272).
    if (sale.status !== 'paid') return error('transaction_not_available_for_cancel');
    // The cut-off is agreed with each merchant, so the test sets it. A refund past it answers as
    // DEV refused late refunds, the sale staying paid (W c1563, c1567, c1834).
    const windowMinutes = this.#refundWindowMinutes;
    if (windowMinutes === undefined) {
      return unsimulated('payments.refund without refundWindowMinutes, a per-merchant cut-off');
    }
    const refundedAt = this.#wireNow();
    const elapsedMs = refundedAt.getTime() - sale.paidOrCreatedAt.getTime();
    if (elapsedMs >= windowMinutes * MINUTE_MS) {
      return error('transaction_not_available_for_cancel');
    }
    // `cancel` with the refund time; `date` and the amount stay (W c111, c113). When the refunded
    // money reaches the card is unobserved.
    if (sale.cardId !== null) this.#giveBack(sale.cardId, sale.amountTiyin, 'unobserved');
    this.state.sales.set(transactionId, { ...sale, status: 'refunded', refundedAt });
    this.#registerRefundReceipt(transactionId, refundedAt);
    return result({ transactionId, refundedAt });
  }

  /**
   * The refund of a fiscalized payment registers its refund receipt in the background: none right
   * after the refund, then one carrying the refund time (W c1666, c1685, c1689, c1691).
   */
  #registerRefundReceipt(transactionId: string, refundedAt: Date): void {
    const receipts = this.state.receipts.get(transactionId);
    if (receipts === undefined) return;
    const delaySeconds = this.#refundReceiptDelaySeconds;
    const visibleAt =
      delaySeconds === undefined ? null : new Date(refundedAt.getTime() + delaySeconds * 1000);
    this.state.receipts.set(transactionId, {
      ...receipts,
      refund: { receipt: this.#issueReceipt(refundedAt), visibleAt },
    });
  }

  // Transactions

  /**
   * The gateway's empty list for an unknown id reads as `transaction_not_found` (W c144); a
   * non-UUID id is `validation_error` (W c143).
   */
  getTransaction({ transactionId }: GetTransactionParams): SimulatedOutcome<Transaction> {
    const transaction = this.#transaction(transactionId);
    if (transaction === 'unknown') {
      return unsimulated('transactions.get of a refund whose refund receipt timing is unset');
    }
    if (transaction !== undefined) return result(transaction);
    return unknownTransaction(
      transactionId,
      'transactions.get',
      error('transaction_not_found'),
      true,
    );
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
    // Paid rows only, newest payment first, inclusive Tashkent days (W c136, c346, c703). A paid
    // row has no refund receipt, so its receipts are always known.
    const rows = this.#transactions().filter((transaction) => {
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

  /**
   * The transaction row with its receipts, `undefined` for an unknown id, or `unknown` when its
   * refund receipt's timing is unset.
   */
  #transaction(transactionId: string): Transaction | 'unknown' | undefined {
    const receipts = this.#receiptSummaries(transactionId);
    if (receipts === 'unknown') return 'unknown';
    const hold = this.state.holds.get(transactionId);
    if (hold !== undefined) return transactionOf(hold, receipts);
    const sale = this.state.sales.get(transactionId);
    return sale === undefined ? undefined : saleTransactionOf(sale, receipts);
  }

  /** Every transaction whose receipts are known. */
  #transactions(): Transaction[] {
    const ids = [...this.state.sales.keys(), ...this.state.holds.keys()];
    return ids.flatMap((id) => {
      const transaction = this.#transaction(id);
      return transaction === undefined || transaction === 'unknown' ? [] : [transaction];
    });
  }

  /** The sale receipt, then the refund receipt once reads show it (W c1631, c1697). */
  #receiptSummaries(transactionId: string): readonly FiscalReceiptSummary[] | 'unknown' {
    const receipts = this.state.receipts.get(transactionId);
    if (receipts === undefined) return [];
    const refund = visibleRefund(receipts, this.#now().getTime());
    if (refund === 'unknown') return 'unknown';
    const sale = summaryOf(receipts.sale, false);
    return refund === null ? [sale] : [sale, summaryOf(refund, true)];
  }

  // Holds

  createHold(params: CreateHoldParams): SimulatedOutcome<TransactionReference> {
    const known = this.state.cards.get(params.cardId);
    if (known === undefined || known.isDeleted) return error('card_not_found'); // W c207, c328
    const { card } = known;
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
    // DEV held small amounts and declined larger ones on the same card (W c600–c610).
    const shortfall = this.#take(known, params.amountTiyin, 'holds.create');
    if (shortfall !== undefined) return unsimulated(shortfall);
    const transactionId = this.#newId();
    this.#holdIdsByExternalId.set(params.externalId, transactionId);
    this.state.holds.set(transactionId, {
      transactionId,
      externalId: params.externalId,
      userId: params.userId,
      cardId: card.cardId,
      maskedCardNumber: card.maskedCardNumber,
      heldAmountTiyin: params.amountTiyin,
      createdAt: this.#wireNow(),
      expiresAt: new Date(this.#now().getTime() + params.durationMinutes * MINUTE_MS),
      serviceId: SIMULATED_MERCHANT_ID, // W c184
      settlement: { kind: 'held' },
    });
    return result({ transactionId });
  }

  capture({ transactionId, amountTiyin }: CaptureHoldParams): SimulatedOutcome<HoldCaptured> {
    const hold = this.state.holds.get(transactionId);
    if (hold === undefined) {
      // W c193
      if (this.state.sales.has(transactionId))
        return error('transaction_not_available_for_payment');
      // W c192
      return unknownTransaction(
        transactionId,
        'holds.capture',
        error('transaction_not_found'),
        false,
      );
    }
    if (hold.settlement.kind !== 'held') return captureOfSettled(hold);
    // `validation_error` below 10 SUM (W c189); its error data is not simulated.
    if (amountTiyin < MIN_HOLD_AMOUNT_TIYIN) return unsimulated('holds.capture below 10 SUM');
    const isExpired = this.#now().getTime() >= hold.expiresAt.getTime();
    // A deleted card's open hold captured in full (W c1903, c1921); nothing else was tried.
    if (!this.#isCardBound(hold.cardId) && (isExpired || amountTiyin !== hold.heldAmountTiyin)) {
      return unsimulated('holds.capture after the card was deleted, expired or not in full');
    }
    if (isExpired && amountTiyin > hold.heldAmountTiyin) {
      return unsimulated('holds.capture of an expired hold above the held amount');
    }
    if (isExpired) {
      // Released by the failed capture (W c1276, c1277, c1280); only a dismiss is documented to
      // make the funds available again.
      this.#giveBack(hold.cardId, hold.heldAmountTiyin, 'unobserved');
      this.#writeHold({
        ...hold,
        settlement: { kind: 'released', at: this.#wireNow(), by: 'expiry', wasExpired: true },
      });
      return error('hold_time_expired');
    }
    if (amountTiyin > hold.heldAmountTiyin) return error('invalid_amount'); // W c188
    // A partial capture ends the hold (W c194–c197); Paylov and the bank return the remainder on
    // their own schedule (M 2026-11-15).
    this.#giveBack(hold.cardId, hold.heldAmountTiyin - amountTiyin, 'unobserved');
    const capturedAt = this.#wireNow();
    this.#writeHold({ ...hold, settlement: { kind: 'captured', amountTiyin, at: capturedAt } });
    return result({ transactionId, cardId: hold.cardId, capturedAt });
  }

  release({ transactionId }: ReleaseHoldParams): SimulatedOutcome<TransactionReference> {
    const hold = this.state.holds.get(transactionId);
    if (hold === undefined)
      return unsimulated('holds.release of an unknown or non-hold transaction');
    // After a capture (W c197), a release (W c200), or an expired capture's release (W c1278).
    if (hold.settlement.kind !== 'held') return error('hold_not_found');
    // Also after the duration ran out, without a capture attempt (W c198, c199, c1036, c1037). The
    // docs make the funds available after a dismiss (D), but say nothing about an expired hold.
    const isExpired = this.#now().getTime() >= hold.expiresAt.getTime();
    // A deleted card's open hold released before it expired (W c1906, c1924).
    if (!this.#isCardBound(hold.cardId) && isExpired) {
      return unsimulated('holds.release of an expired hold after the card was deleted');
    }
    this.#giveBack(hold.cardId, hold.heldAmountTiyin, isExpired ? 'unobserved' : 'now');
    this.#writeHold({
      ...hold,
      settlement: { kind: 'released', at: this.#wireNow(), by: 'dismiss', wasExpired: isExpired },
    });
    return result({ transactionId });
  }

  /** Expiry alone never changes the status: an expired hold still reads `held` (W c1034, c1035). */
  getHold(lookup: GetHoldParams): SimulatedOutcome<Hold> {
    const transactionId =
      lookup.transactionId ?? this.#holdIdsByExternalId.get(lookup.externalId) ?? '';
    const hold = this.state.holds.get(transactionId);
    if (hold !== undefined) return result(holdOf(hold));
    if (this.state.sales.has(transactionId)) {
      return unsimulated('holds.get of a transaction that is not a hold');
    }
    // W c210, c211
    const missing = error<Hold>('transaction_not_found');
    if (lookup.transactionId === undefined) return missing;
    return unknownTransaction(lookup.transactionId, 'holds.get', missing, false);
  }

  #writeHold(hold: SimulatedHold): void {
    this.state.holds.set(hold.transactionId, hold);
  }

  #isCardBound(cardId: string): boolean {
    return this.state.cards.get(cardId)?.isDeleted === false;
  }

  // Fiscalization. The simulated merchant registers its own receipts, as the DEV merchant does
  // (W c1629, c1601). The OFD's item checks (package codes, commitents) are not simulated: any
  // item registers.

  registerReceipt({
    transactionId,
    items,
  }: RegisterFiscalReceiptParams): SimulatedOutcome<FiscalReceiptRegistered> {
    const transaction = this.#transaction(transactionId);
    if (transaction === undefined) {
      // W c1602
      return unknownTransaction(
        transactionId,
        'fiscalization.registerReceipt',
        error('transaction_not_found'),
        false,
      );
    }
    const isPaid = transaction !== 'unknown' && transaction.status === 'paid';
    if (this.state.receipts.has(transactionId)) {
      return isPaid
        ? error('ofd_check_already_generated') // W c1702
        : unsimulated('fiscalization.registerReceipt of a refunded fiscalized transaction');
    }
    if (!isPaid) {
      return unsimulated('fiscalization.registerReceipt of a transaction that is not paid');
    }
    const lineTotals = items.map(lineTotalTiyin);
    if (lineTotals.length === 0 || lineTotals.includes(undefined)) {
      return unsimulated(
        'fiscalization.registerReceipt without items or with a discount above the price',
      );
    }
    const totalTiyin = lineTotals.reduce<number>((total, line) => total + (line ?? 0), 0);
    if (totalTiyin !== transaction.amountTiyin) {
      // A captured hold totals its captured amount; items for the held amount fail (W c1873).
      return totalTiyin === this.state.holds.get(transactionId)?.heldAmountTiyin
        ? error('invalid_amount')
        : unsimulated(
            'fiscalization.registerReceipt with items that do not total the transaction amount',
          );
    }
    // A captured hold registers like a payment, for its captured amount (W c1860, c1874). A sale receipt carries the payment time, not the registration time (W c1608, c1629).
    const sale = this.#issueReceipt(transaction.paidOrCreatedAt);
    this.state.receipts.set(transactionId, { sale, refund: undefined });
    return result(registeredOf(sale));
  }

  getReceipt({
    transactionId,
    isRefund,
  }: GetFiscalReceiptParams): SimulatedOutcome<FiscalReceipt | null> {
    const transaction = this.#transaction(transactionId);
    if (transaction === undefined) {
      // W c1308, c849
      return unknownTransaction(
        transactionId,
        'fiscalization.getReceipt',
        error('transaction_not_found'),
        true,
      );
    }
    const receipts = this.state.receipts.get(transactionId);
    if (receipts === undefined) {
      // A paid payment or captured hold without a receipt (W c274, c861, c1305–c1307).
      return transaction !== 'unknown' && transaction.status === 'paid'
        ? result(null)
        : unsimulated('fiscalization.getReceipt of an unfiscalized transaction that is not paid');
    }
    if (isRefund === false) return result(fiscalReceiptOf(receipts.sale, false));
    const refund = visibleRefund(receipts, this.#now().getTime());
    if (refund === 'unknown') {
      return unsimulated('fiscalization.getReceipt of a refund receipt whose timing is unset');
    }
    // `true` before the refund receipt exists answers none; omitted, the refund receipt wins
    // (W c1662, c1666, c1696).
    if (refund !== null) return result(fiscalReceiptOf(refund, true));
    return result(isRefund === true ? null : fiscalReceiptOf(receipts.sale, false));
  }

  refundReceipt({ receiptId }: RefundFiscalReceiptParams): SimulatedOutcome<FiscalReceiptRefunded> {
    const entries = [...this.state.receipts];
    const found = entries.find(([, receipts]) => receipts.sale.receiptId === receiptId);
    if (found === undefined) {
      return entries.some(([, receipts]) => receipts.refund?.receipt.receiptId === receiptId)
        ? unsimulated('fiscalization.refundReceipt of a refund receipt')
        : error('ofd_check_not_found'); // W c1600
    }
    const [transactionId, receipts] = found;
    // A paid payment is not refunded yet (W c1659, c1664).
    if (this.state.sales.get(transactionId)?.status !== 'refunded') {
      return this.state.holds.has(transactionId)
        ? unsimulated('fiscalization.refundReceipt of a captured hold')
        : error('receipt_not_available_for_operation');
    }
    // The refund already registered one (W c1694).
    const refund = visibleRefund(receipts, this.#now().getTime());
    if (refund !== null && refund !== 'unknown') return error('ofd_check_already_generated');
    return unsimulated('fiscalization.refundReceipt before the refund receipt shows');
  }

  /**
   * A receipt with the documented URL shape, `<time>` being `issuedAt` in Tashkent time
   * (W c1608, c1629).
   */
  #issueReceipt(issuedAt: Date): IssuedReceipt {
    const receiptId = this.state.nextReceiptId;
    this.state.nextReceiptId += 1;
    const fiscalSign = String(receiptId).padStart(12, '0');
    const time = tashkentDateTimeOf(issuedAt, 'issuedAt').replaceAll(/\D/g, '');
    const receiptUrl = `https://ofd.soliq.uz/epi?t=${SIMULATED_TERMINAL_ID}&r=${receiptId}&c=${time}&s=${fiscalSign}`;
    return { receiptId, receiptUrl, terminalId: SIMULATED_TERMINAL_ID, fiscalSign, issuedAt };
  }

  /**
   * Takes `amountTiyin` from what the card's spending allowance has left, or names why the
   * simulation cannot answer: Paylov documents no link between a reported balance and an approval,
   * so a card without an allowance approves nothing, and when returning funds arrive is unobserved.
   */
  #take(known: SimulatedCard, amountTiyin: number, method: string): string | undefined {
    const { spendableTiyin } = known;
    if (spendableTiyin === undefined) {
      return `${method} on a card added without spendableTiyin; its reported balance does not decide approval`;
    }
    const ledger = known.ledger ?? { takenTiyin: 0, returningTiyin: 0 };
    const left = spendableTiyin - ledger.takenTiyin - ledger.returningTiyin;
    if (amountTiyin > left + ledger.returningTiyin) {
      return `${method} of more than the card's spendableTiyin covers`;
    }
    if (amountTiyin > left) {
      return `${method} that only refunded, uncaptured or expired-hold funds would cover`;
    }
    this.#setLedger(known.card.cardId, {
      ...ledger,
      takenTiyin: ledger.takenTiyin + amountTiyin,
    });
    return undefined;
  }

  /** Ends a charge or reservation: its funds are back on the card now or at an unobserved time. */
  #giveBack(cardId: string, amountTiyin: number, arrival: 'now' | 'unobserved'): void {
    const ledger = this.state.cards.get(cardId)?.ledger ?? { takenTiyin: 0, returningTiyin: 0 };
    this.#setLedger(cardId, {
      takenTiyin: ledger.takenTiyin - amountTiyin,
      returningTiyin: ledger.returningTiyin + (arrival === 'now' ? 0 : amountTiyin),
    });
  }

  #setLedger(cardId: string, ledger: CardLedger): void {
    const known = this.state.cards.get(cardId);
    if (known !== undefined) this.state.cards.set(cardId, { ...known, ledger });
  }

  #wireNow(): Date {
    return wholeSeconds(this.#now().getTime());
  }

  #newId(): string {
    const id = `00000000-0000-4000-a000-${this.state.nextId.toString(16).padStart(12, '0')}`;
    this.state.nextId += 1;
    return id;
  }
}
