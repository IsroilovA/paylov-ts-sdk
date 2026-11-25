import {
  optionalEntry,
  type FakeCodec,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
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

function encodeCard(card: Card, status: unknown): unknown {
  return {
    cardId: card.cardId,
    userId: card.userId,
    owner: card.holderName,
    cardName: card.cardName,
    number: card.maskedCardNumber,
    balance: card.balanceTiyin,
    bankId: card.bankId,
    bankName: card.bankName,
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

function encodePanBindingStarted(started: PanBindingStarted): unknown {
  return { cid: started.cardId, otpSentPhone: started.otpSentPhone };
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
  return { cardId: body.string('cardId'), phoneNumber: body.string('phoneNumber') };
}

export const CARD_CODECS: {
  readonly get: FakeCodec<Card, GetCardParams>;
  readonly list: FakeCodec<readonly Card[], ListCardsParams>;
  readonly delete: FakeCodec<void, DeleteCardParams>;
} = {
  get: { encode: encodeFetchedCard, decodeRequest: decodeGetRequest },
  list: { encode: encodeCardList, decodeRequest: decodeListRequest },
  delete: { encode: encodeTrue, decodeRequest: decodeDeleteRequest },
};

export function createCardsFake(
  script: Scripter<'cards', CardsResource>,
): PaylovFakeSurface<CardsResource> {
  return {
    startPanBinding: script(
      'cards.startPanBinding',
      ENDPOINTS.startPanBinding,
      encodePanBindingStarted,
      decodeStartPanBindingRequest,
    ),
    confirmPanBinding: script(
      'cards.confirmPanBinding',
      ENDPOINTS.confirmPanBinding,
      encodeConfirmedCard,
      decodeConfirmPanBindingRequest,
    ),
    get: script('cards.get', ENDPOINTS.get, CARD_CODECS.get.encode, CARD_CODECS.get.decodeRequest),
    list: script(
      'cards.list',
      ENDPOINTS.list,
      CARD_CODECS.list.encode,
      CARD_CODECS.list.decodeRequest,
    ),
    delete: script(
      'cards.delete',
      ENDPOINTS.delete,
      CARD_CODECS.delete.encode,
      CARD_CODECS.delete.decodeRequest,
    ),
    checkPhone: script(
      'cards.checkPhone',
      ENDPOINTS.checkPhone,
      encodeMatch,
      decodeCheckPhoneRequest,
    ),
  };
}
