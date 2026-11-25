import {
  arrayOf,
  asBoolean,
  asMaskedPan,
  asString,
  asTiyin,
  type Decoder,
  fieldOf,
  nullable,
  nullish,
  readFields,
} from '../core/decoding.js';
import type { Card, PanBindingStarted } from './types.js';

type CardState = Pick<Card, 'isActive' | 'processingStatus' | 'isSmsEnabled'>;

const decodeFlatStatus: Decoder<CardState> = (value, path) => {
  const status = readFields(value, path);
  return {
    isActive: status('is_active', asBoolean),
    processingStatus: status('status_message', asString),
    isSmsEnabled: status('sms_info', asBoolean),
  };
};

/**
 * Each endpoint has exactly one status layout and never falls back to the other, so a layout
 * change surfaces as `sdk_malformed_response`. An error inside the confirm status is an inactive
 * status: `is_active: false` with the reason in `status_message`.
 */
function cardDecoder(decodeStatus: Decoder<CardState>): Decoder<Card> {
  return (value, path) => {
    const card = readFields(value, path);
    const cardName = card('cardName', nullable(asString));
    return {
      cardId: card('cardId', asString),
      userId: card('userId', asString),
      holderName: card('owner', asString),
      cardName: cardName === '' ? null : cardName,
      maskedCardNumber: card('number', asMaskedPan),
      balanceTiyin: card('balance', asTiyin),
      bankId: card('bankId', asString),
      bankName: card('bankName', nullish(asString)),
      vendor: card('vendor', asString),
      processing: card('processing', asString),
      ...card('status', decodeStatus),
    };
  };
}

/** Confirm carries a flat `status`. */
const decodeFlatCard: Decoder<Card> = cardDecoder(decodeFlatStatus);
/** `getCard` and `getAllUserCards` nest it as `status.result`. */
const decodeNestedCard: Decoder<Card> = cardDecoder(fieldOf('result', decodeFlatStatus));

export const decodeConfirmedCard: Decoder<Card> = fieldOf('card', decodeFlatCard);
export const decodeFetchedCard: Decoder<Card> = fieldOf('card', decodeNestedCard);
export const decodeCardList: Decoder<readonly Card[]> = fieldOf('cards', arrayOf(decodeNestedCard));

export const decodePanBindingStarted: Decoder<PanBindingStarted> = (value, path) => {
  const result = readFields(value, path);
  return {
    cardId: result('cid', asString),
    // The OTP is already sent, so no mask format may fail the call.
    otpSentPhone: result('otpSentPhone', asString),
  };
};

/** `{match: boolean}`, the documented answer of the phone check. */
export const decodeMatch: Decoder<boolean> = fieldOf('match', asBoolean);

/** Delete answers `result: true`; the envelope alone signals its success. */
export const decodeDeleted: Decoder<void> = () => undefined;
