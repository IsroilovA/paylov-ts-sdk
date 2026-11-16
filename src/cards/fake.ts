import {
  optionalEntry,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
import { decodeOtpSms } from '../shared/fake.js';
import { ENDPOINTS, type CardsResource } from './resource.js';
import type {
  Card,
  CardBindLinkCreated,
  CardBindSession,
  CheckCardPhoneParams,
  ConfirmPanBindingParams,
  CreateBindLinkParams,
  DeleteCardParams,
  GetBindSessionParams,
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

/** Confirm and the bind session send a flat `status`. */
function encodeFlatCard(card: Card): unknown {
  return encodeCard(card, encodeCardStatus(card));
}

/** Reads nest the status as `status.result`. */
function encodeNestedCard(card: Card): unknown {
  return encodeCard(card, { result: encodeCardStatus(card) });
}

function encodeBindLinkCreated(created: CardBindLinkCreated): unknown {
  return {
    token: created.token,
    bindUrl: created.bindUrl,
    expiresAt: created.expiresAt.toISOString(),
  };
}

function encodeBindSession(session: CardBindSession): unknown {
  const card = session.card === null ? null : encodeFlatCard(session.card);
  return { state: session.status, card };
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

function decodeCreateBindLinkRequest({ body }: FakeRequest): CreateBindLinkParams {
  return {
    userId: body.string('userId'),
    ...optionalEntry('returnUrl', body.optionalString('returnUrl')),
  };
}

function decodeBindSessionRequest({ path }: FakeRequest): GetBindSessionParams {
  return { token: path.string('token') };
}

function decodeStartPanBindingRequest({ body }: FakeRequest): StartPanBindingParams {
  return {
    userId: body.string('userId'),
    cardNumber: body.string('cardNumber'),
    cardExpiry: body.string('expireDate'),
    ...optionalEntry('phoneNumber', body.optionalString('phoneNumber')),
    ...optionalEntry('sms', body.optionalObject('sms', decodeOtpSms)),
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

export function createCardsFake(
  script: Scripter<'cards', CardsResource>,
): PaylovFakeSurface<CardsResource> {
  return {
    createBindLink: script(
      'cards.createBindLink',
      ENDPOINTS.createBindLink,
      encodeBindLinkCreated,
      decodeCreateBindLinkRequest,
    ),
    getBindSession: script(
      'cards.getBindSession',
      ENDPOINTS.getBindSession,
      encodeBindSession,
      decodeBindSessionRequest,
    ),
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
    get: script('cards.get', ENDPOINTS.get, encodeFetchedCard, decodeGetRequest),
    list: script('cards.list', ENDPOINTS.list, encodeCardList, decodeListRequest),
    delete: script('cards.delete', ENDPOINTS.delete, encodeTrue, decodeDeleteRequest),
    checkPhone: script(
      'cards.checkPhone',
      ENDPOINTS.checkPhone,
      encodeMatch,
      decodeCheckPhoneRequest,
    ),
  };
}
