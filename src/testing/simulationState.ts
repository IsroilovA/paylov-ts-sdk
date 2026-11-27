/**
 * The state of the gateway simulation as plain records, and its JSON form, so the simulator
 * server can persist it across restarts. It never holds a full card number or an OTP: a binding
 * names its card by the masked number.
 */

import type { Card } from '../cards/types.js';
import { optionalEntry } from '../core/fake.js';
import { readConfig, type Params } from '../core/params.js';

const STATE_VERSION = 1;
const STATE_LABEL = 'gateway simulator state';

/**
 * What the simulation moved on one card, against the spending allowance the test gave it; the
 * card's reported balance never changes and never decides an approval.
 */
export interface CardLedger {
  /** Paid or still held: no longer available. */
  readonly takenTiyin: number;
  /**
   * Refunded, left uncaptured by a partial capture, or released after the hold expired: Paylov
   * gives it back on a schedule DEV did not show, so no request may rely on it.
   */
  readonly returningTiyin: number;
}

export interface SimulatedCard {
  readonly card: Card;
  /** What pays and holds may take from the card in total; a test assumption, never a balance. */
  readonly spendableTiyin: number | undefined;
  /** Set once the simulation moved funds on the card; its balance reads then stay unsimulated. */
  readonly ledger: CardLedger | undefined;
  readonly isDeleted: boolean;
}

/** Which cards a user's last fresh list saw. Confirmation leaves that list cached. */
export interface CachedCardList {
  readonly userId: string;
  readonly expiresAtMs: number;
  readonly cardIds: ReadonlySet<string>;
}

/** A payment created with `payments.create`. */
export interface SimulatedSale {
  readonly transactionId: string;
  readonly userId: string | null;
  readonly cardId: string | null;
  readonly maskedCardNumber: string | null;
  readonly amountTiyin: number;
  readonly status: 'created' | 'paid' | 'refunded';
  /** The creation time, replaced by the payment time once paid. */
  readonly paidOrCreatedAt: Date;
  readonly refundedAt: Date | null;
}

/** Where a hold stands; the hold record and its transaction row both derive from it. */
export type Settlement =
  | { readonly kind: 'held' }
  | {
      readonly kind: 'captured';
      readonly amountTiyin: number;
      readonly at: Date;
      readonly refundedAt: Date | null;
    }
  | {
      readonly kind: 'released';
      readonly at: Date;
      readonly by: 'dismiss' | 'expiry';
      /** Decided against the hold's millisecond expiry when it was released, never from `at`. */
      readonly wasExpired: boolean;
    };

export interface SimulatedHold {
  readonly transactionId: string;
  readonly externalId: string;
  readonly userId: string;
  readonly cardId: string;
  readonly maskedCardNumber: string | null;
  readonly heldAmountTiyin: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly serviceId: string;
  readonly settlement: Settlement;
}

/** A PAN binding `cards.startPanBinding` started; confirmed, its `cardId` is a bound card. */
export interface PanBinding {
  readonly cardId: string;
  readonly userId: string;
  /** Names the simulated card; the simulation never stores the full card number. */
  readonly maskedCardNumber: string;
  readonly otpSentAt: Date;
  readonly wrongOtps: number;
  readonly isConfirmed: boolean;
  /** A deleted pending binding still has a live resend cooldown (W c2034, c2039). */
  readonly isDeleted: boolean;
}

/** A fiscal receipt the simulated OFD registered. */
export interface IssuedReceipt {
  readonly receiptId: number;
  readonly receiptUrl: string;
  readonly terminalId: string;
  readonly fiscalSign: string;
  /** The payment time for a sale, the refund time for a refund. */
  readonly issuedAt: Date;
}

/** The refund receipt a refund of a fiscalized payment registers in the background. */
export interface RefundReceipt {
  readonly receipt: IssuedReceipt;
  /** When reads start to show it; `null` when the test chose no delay, so reads are unsimulated. */
  readonly visibleAt: Date | null;
}

/** The receipts of one fiscalized transaction. */
export interface TransactionReceipts {
  readonly sale: IssuedReceipt;
  readonly refund: RefundReceipt | undefined;
}

interface SimulatedShare {
  readonly recipientId: string;
  readonly amountTiyin: number;
}

/** One allocation per submitted recipient; share statuses follow the parent transaction. */
export interface SimulatedSplit {
  readonly transactionId: string;
  readonly createdAt: Date;
  readonly shares: readonly SimulatedShare[];
}

export interface SimulationState {
  nextId: number;
  nextReceiptId: number;
  readonly cards: Map<string, SimulatedCard>;
  readonly cardLists: Map<string, CachedCardList>;
  readonly sales: Map<string, SimulatedSale>;
  readonly holds: Map<string, SimulatedHold>;
  readonly splits: Map<string, SimulatedSplit>;
  /** Keyed by the binding's `cardId`. */
  readonly bindings: Map<string, PanBinding>;
  /** Keyed by transaction id. */
  readonly receipts: Map<string, TransactionReceipts>;
}

export function emptySimulationState(): SimulationState {
  return {
    nextId: 1,
    nextReceiptId: 1,
    cards: new Map(),
    cardLists: new Map(),
    sales: new Map(),
    holds: new Map(),
    splits: new Map(),
    bindings: new Map(),
    receipts: new Map(),
  };
}

// Encoding: dates as epoch milliseconds, `null` as an absent key.

function nullableEntry<K extends string, V>(key: K, value: V | null): Partial<Record<K, V>> {
  return optionalEntry(key, value ?? undefined);
}

function msOf(date: Date | null): number | null {
  return date === null ? null : date.getTime();
}

function encodeCard({ cardName, bankName, ...card }: Card): unknown {
  return {
    ...card,
    ...nullableEntry('cardName', cardName),
    ...nullableEntry('bankName', bankName),
  };
}

function encodeSimulatedCard({ card, spendableTiyin, ledger, isDeleted }: SimulatedCard): unknown {
  return { card: encodeCard(card), spendableTiyin, ledger, isDeleted };
}

function encodeCachedCardList({ userId, expiresAtMs, cardIds }: CachedCardList): unknown {
  return { userId, expiresAtMs, cards: [...cardIds].map((cardId) => ({ cardId })) };
}

function encodeSale(sale: SimulatedSale): unknown {
  return {
    transactionId: sale.transactionId,
    ...nullableEntry('userId', sale.userId),
    ...nullableEntry('cardId', sale.cardId),
    ...nullableEntry('maskedCardNumber', sale.maskedCardNumber),
    amountTiyin: sale.amountTiyin,
    status: sale.status,
    paidOrCreatedAt: sale.paidOrCreatedAt.getTime(),
    ...nullableEntry('refundedAt', msOf(sale.refundedAt)),
  };
}

function encodeSettlement(settlement: Settlement): unknown {
  if (settlement.kind === 'held') return { kind: 'held' };
  if (settlement.kind === 'captured') {
    return {
      kind: 'captured',
      amountTiyin: settlement.amountTiyin,
      at: settlement.at.getTime(),
      ...nullableEntry('refundedAt', msOf(settlement.refundedAt)),
    };
  }
  return {
    kind: 'released',
    at: settlement.at.getTime(),
    by: settlement.by,
    wasExpired: settlement.wasExpired,
  };
}

function encodeHold({ maskedCardNumber, ...hold }: SimulatedHold): unknown {
  return {
    ...hold,
    ...nullableEntry('maskedCardNumber', maskedCardNumber),
    createdAt: hold.createdAt.getTime(),
    expiresAt: hold.expiresAt.getTime(),
    settlement: encodeSettlement(hold.settlement),
  };
}

function encodeSplit(split: SimulatedSplit): unknown {
  return { ...split, createdAt: split.createdAt.getTime() };
}

function encodeBinding(binding: PanBinding): unknown {
  return { ...binding, otpSentAt: binding.otpSentAt.getTime() };
}

function encodeReceipt(receipt: IssuedReceipt): unknown {
  return { ...receipt, issuedAt: receipt.issuedAt.getTime() };
}

function encodeReceipts(transactionId: string, receipts: TransactionReceipts): unknown {
  const { sale, refund } = receipts;
  return {
    transactionId,
    sale: encodeReceipt(sale),
    ...(refund === undefined
      ? {}
      : {
          refund: {
            receipt: encodeReceipt(refund.receipt),
            ...nullableEntry('visibleAt', msOf(refund.visibleAt)),
          },
        }),
  };
}

/** The JSON value `decodeSimulationState` reads back. */
export function encodeSimulationState(state: SimulationState): unknown {
  return {
    version: STATE_VERSION,
    nextId: state.nextId,
    nextReceiptId: state.nextReceiptId,
    cards: [...state.cards.values()].map(encodeSimulatedCard),
    cardLists: [...state.cardLists.values()].map(encodeCachedCardList),
    sales: [...state.sales.values()].map(encodeSale),
    holds: [...state.holds.values()].map(encodeHold),
    splits: [...state.splits.values()].map(encodeSplit),
    bindings: [...state.bindings.values()].map(encodeBinding),
    receipts: [...state.receipts].map(([id, receipts]) => encodeReceipts(id, receipts)),
  };
}

// Decoding: every value is read from `unknown`; a failure names the field, never its value.

function dateAt(params: Params, key: string): Date {
  return new Date(params.integer(key));
}

function optionalDateAt(params: Params, key: string): Date | null {
  const ms = params.optionalInteger(key);
  return ms === undefined ? null : new Date(ms);
}

function decodeCard(params: Params): Card {
  return {
    cardId: params.string('cardId'),
    userId: params.string('userId'),
    holderName: params.string('holderName'),
    cardName: params.optionalString('cardName') ?? null,
    maskedCardNumber: params.string('maskedCardNumber'),
    balanceTiyin: params.tiyin('balanceTiyin'),
    bankId: params.string('bankId'),
    bankName: params.optionalString('bankName') ?? null,
    vendor: params.string('vendor'),
    processing: params.string('processing'),
    isActive: params.boolean('isActive'),
    processingStatus: params.string('processingStatus'),
    isSmsEnabled: params.boolean('isSmsEnabled'),
  };
}

function decodeLedger(params: Params): CardLedger {
  return {
    takenTiyin: params.integer('takenTiyin'),
    returningTiyin: params.integer('returningTiyin'),
  };
}

function decodeSimulatedCard(params: Params): SimulatedCard {
  return {
    card: params.object('card', decodeCard),
    spendableTiyin: params.optionalTiyin('spendableTiyin'),
    ledger: params.optionalObject('ledger', decodeLedger),
    isDeleted: params.boolean('isDeleted'),
  };
}

function decodeSale(params: Params): SimulatedSale {
  return {
    transactionId: params.string('transactionId'),
    userId: params.optionalString('userId') ?? null,
    cardId: params.optionalString('cardId') ?? null,
    maskedCardNumber: params.optionalString('maskedCardNumber') ?? null,
    amountTiyin: params.tiyin('amountTiyin'),
    status: params.literal('status', ['created', 'paid', 'refunded']),
    paidOrCreatedAt: dateAt(params, 'paidOrCreatedAt'),
    refundedAt: optionalDateAt(params, 'refundedAt'),
  };
}

function decodeSettlement(params: Params): Settlement {
  const kind = params.literal('kind', ['held', 'captured', 'released']);
  if (kind === 'held') return { kind };
  if (kind === 'captured') {
    return {
      kind,
      amountTiyin: params.tiyin('amountTiyin'),
      at: dateAt(params, 'at'),
      refundedAt: optionalDateAt(params, 'refundedAt'),
    };
  }
  return {
    kind,
    at: dateAt(params, 'at'),
    by: params.literal('by', ['dismiss', 'expiry']),
    wasExpired: params.boolean('wasExpired'),
  };
}

function decodeHold(params: Params): SimulatedHold {
  return {
    transactionId: params.string('transactionId'),
    externalId: params.string('externalId'),
    userId: params.string('userId'),
    cardId: params.string('cardId'),
    maskedCardNumber: params.optionalString('maskedCardNumber') ?? null,
    heldAmountTiyin: params.tiyin('heldAmountTiyin'),
    createdAt: dateAt(params, 'createdAt'),
    expiresAt: dateAt(params, 'expiresAt'),
    serviceId: params.string('serviceId'),
    settlement: params.object('settlement', decodeSettlement),
  };
}

function decodeSplit(params: Params): SimulatedSplit {
  return {
    transactionId: params.string('transactionId'),
    createdAt: dateAt(params, 'createdAt'),
    shares: params.array('shares', (share) => ({
      recipientId: share.string('recipientId'),
      amountTiyin: share.tiyin('amountTiyin'),
    })),
  };
}

function decodeBinding(params: Params): PanBinding {
  return {
    cardId: params.string('cardId'),
    userId: params.string('userId'),
    maskedCardNumber: params.string('maskedCardNumber'),
    otpSentAt: dateAt(params, 'otpSentAt'),
    wrongOtps: params.integer('wrongOtps'),
    isConfirmed: params.boolean('isConfirmed'),
    isDeleted: params.optionalBoolean('isDeleted') ?? false,
  };
}

function decodeCachedCardList(params: Params): CachedCardList {
  return {
    userId: params.string('userId'),
    expiresAtMs: params.integer('expiresAtMs'),
    cardIds: new Set(params.array('cards', (card) => card.string('cardId'))),
  };
}

function decodeReceipt(params: Params): IssuedReceipt {
  return {
    receiptId: params.integer('receiptId'),
    receiptUrl: params.string('receiptUrl'),
    terminalId: params.string('terminalId'),
    fiscalSign: params.string('fiscalSign'),
    issuedAt: dateAt(params, 'issuedAt'),
  };
}

function decodeRefundReceipt(params: Params): RefundReceipt {
  return {
    receipt: params.object('receipt', decodeReceipt),
    visibleAt: optionalDateAt(params, 'visibleAt'),
  };
}

function decodeReceipts(params: Params): readonly [string, TransactionReceipts] {
  return [
    params.string('transactionId'),
    {
      sale: params.object('sale', decodeReceipt),
      refund: params.optionalObject('refund', decodeRefundReceipt),
    },
  ];
}

function byKey<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  return new Map(values.map((value) => [key(value), value]));
}

/**
 * Reads a value `encodeSimulationState` wrote. Throws `PaylovInputError` `sdk_config_error`
 * naming the first field that does not read back; never quotes a value.
 */
export function decodeSimulationState(value: unknown): SimulationState {
  const state = readConfig(value, STATE_LABEL);
  state.literal('version', [STATE_VERSION]);
  return {
    nextId: state.integer('nextId'),
    nextReceiptId: state.integer('nextReceiptId'),
    cards: byKey(state.array('cards', decodeSimulatedCard), ({ card }) => card.cardId),
    cardLists: byKey(
      state.optionalArray('cardLists', decodeCachedCardList) ?? [],
      (list) => list.userId,
    ),
    sales: byKey(state.array('sales', decodeSale), (sale) => sale.transactionId),
    holds: byKey(state.array('holds', decodeHold), (hold) => hold.transactionId),
    splits: byKey(state.optionalArray('splits', decodeSplit) ?? [], (split) => split.transactionId),
    bindings: byKey(state.array('bindings', decodeBinding), (binding) => binding.cardId),
    receipts: new Map(state.array('receipts', decodeReceipts)),
  };
}
