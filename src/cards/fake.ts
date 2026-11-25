import { optionalEntry, type FakeRequest, type FakeSpecTable } from '../core/fake.js';
import { ENDPOINTS, type CardsResource } from './resource.js';
import type {
  Card,
  CheckCardPhoneParams,
  ConfirmPanBindingParams,
  DeleteCardParams,
  GetCardParams,
  ListCardsParams,
  PanBindingStarted,
  StartPanBindingParams,
} from './types.js';

function encodeCardStatus(card: Card): unknown {
  return {
    is_active: card.isActive,
    status_message: card.processingStatus,
    sms_info: card.isSmsEnabled,
  };
}

/** A card without a name reads `""` (W c051); a missing bank name is absent, as in the docs. */
function encodeCard(card: Card, status: unknown): unknown {
  return {
    cardId: card.cardId,
    userId: card.userId,
    owner: card.holderName,
    cardName: card.cardName ?? '',
    number: card.maskedCardNumber,
    balance: card.balanceTiyin,
    bankId: card.bankId,
    ...optionalEntry('bankName', card.bankName ?? undefined),
    vendor: card.vendor,
    processing: card.processing,
    status,
  };
}

/** Confirm sends a flat `status`. */
function encodeFlatCard(card: Card): unknown {
  return encodeCard(card, encodeCardStatus(card));
}

/** Reads nest the status as `status.result`. */
function encodeNestedCard(card: Card): unknown {
  return encodeCard(card, { result: encodeCardStatus(card) });
}

/** `code` is undocumented and `null` in every capture (W c025, c029). */
function encodePanBindingStarted(started: PanBindingStarted): unknown {
  return { cid: started.cardId, otpSentPhone: started.otpSentPhone, code: null };
}

function encodeConfirmedCard(card: Card): unknown {
  return { card: encodeFlatCard(card) };
}

function encodeFetchedCard(card: Card): unknown {
  return { card: encodeNestedCard(card) };
}

function encodeCardList(cards: readonly Card[]): unknown {
  return { cards: cards.map(encodeNestedCard) };
}

function encodeTrue(): unknown {
  return true;
}

function encodeMatch(isMatch: boolean): unknown {
  return { match: isMatch };
}

function decodeStartPanBindingRequest({ body }: FakeRequest): StartPanBindingParams {
  return {
    userId: body.string('userId'),
    cardNumber: body.string('cardNumber'),
    cardExpiry: body.string('expireDate'),
    ...optionalEntry('phoneNumber', body.optionalString('phoneNumber')),
  };
}

function decodeConfirmPanBindingRequest({ body }: FakeRequest): ConfirmPanBindingParams {
  return {
    cardId: body.string('cardId'),
    otp: body.string('otp'),
    ...optionalEntry('cardName', body.optionalString('cardName')),
    ...optionalEntry('pinfl', body.optionalString('pinfl')),
  };
}

function decodeGetRequest({ path }: FakeRequest): GetCardParams {
  return { cardId: path.string('cardId') };
}

function decodeListRequest({ query }: FakeRequest): ListCardsParams {
  return { userId: query.string('userId') };
}

function decodeDeleteRequest({ query }: FakeRequest): DeleteCardParams {
  return { cardId: query.string('userCardId') };
}

function decodeCheckPhoneRequest({ body }: FakeRequest): CheckCardPhoneParams {
  return {
    cardId: body.string('cardId'),
    phoneNumber: body.string('phoneNumber'),
  };
}

export const CARD_FAKES: FakeSpecTable<CardsResource> = {
  startPanBinding: {
    endpoint: ENDPOINTS.startPanBinding,
    encode: encodePanBindingStarted,
    decodeRequest: decodeStartPanBindingRequest,
  },
  confirmPanBinding: {
    endpoint: ENDPOINTS.confirmPanBinding,
    encode: encodeConfirmedCard,
    decodeRequest: decodeConfirmPanBindingRequest,
  },
  get: {
    endpoint: ENDPOINTS.get,
    encode: encodeFetchedCard,
    decodeRequest: decodeGetRequest,
  },
  list: {
    endpoint: ENDPOINTS.list,
    encode: encodeCardList,
    decodeRequest: decodeListRequest,
  },
  delete: {
    endpoint: ENDPOINTS.delete,
    encode: encodeTrue,
    decodeRequest: decodeDeleteRequest,
  },
  checkPhone: {
    endpoint: ENDPOINTS.checkPhone,
    encode: encodeMatch,
    decodeRequest: decodeCheckPhoneRequest,
  },
};
