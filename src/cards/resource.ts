import { readCall, send } from '../core/call.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import {
  decodeCardList,
  decodeConfirmedCard,
  decodeFetchedCard,
  decodeMatch,
  decodePanBindingStarted,
  decodeDeleted,
} from './decoders.js';
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

export const ENDPOINTS = {
  startPanBinding: {
    method: 'POST',
    route: '/merchant/userCard/createUserCard/',
    shape: 'envelope',
    effect: 'write',
  },
  confirmPanBinding: {
    method: 'POST',
    route: '/merchant/userCard/confirmUserCardCreate/',
    shape: 'envelope',
    effect: 'write',
  },
  get: {
    method: 'GET',
    route: '/merchant/userCard/getCard/{cardId}/',
    shape: 'envelope',
    effect: 'read',
  },
  list: {
    method: 'GET',
    route: '/merchant/userCard/getAllUserCards/',
    shape: 'envelope',
    effect: 'read',
  },
  delete: {
    method: 'DELETE',
    route: '/merchant/userCard/deleteUserCard/',
    shape: 'envelope',
    effect: 'write',
  },
  checkPhone: {
    method: 'POST',
    route: '/merchant/userCard/checkPhoneMatch/',
    shape: 'envelope',
    effect: 'read',
  },
} as const;

/** The `paylov.cards` namespace. Nothing here moves money. */
export interface CardsResource {
  /**
   * PCI scope: takes a full card number server-side; the SDK keeps it and the expiry out of
   * logger events and errors.
   *
   * Registers a card for a user and makes its processing center (Uzcard or Humo) send an OTP to
   * the phone linked to the card; pass the returned `cardId` and the code to
   * {@link CardsResource.confirmPanBinding}. Without SMS notifications on the card no OTP
   * arrives. While the last OTP is still valid, starting again for the same user and card fails
   * with `otp_code_already_sent`; after it expires, a new start sends a new OTP for the same
   * `cardId`. Moves no money.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, start again; an unconfirmed card is never
   * charged. If the first start ran, a repeat answers `otp_code_already_sent` while its OTP is
   * valid and carries no `cardId`: a caller who still lacks the id starts again after the OTP
   * expires, which returns the same `cardId` with a new OTP.
   *
   * @throws {@link PaylovApiError} `card_not_found` (unknown or unsupported card number),
   * `card_not_match` (wrong expiry), `phone_not_match`, `card_exists` (already bound to this
   * user), `otp_code_already_sent`, `card_not_active`, `sms_not_active`, `card_has_no_phone`.
   *
   * @example
   * const started = await paylov.cards.startPanBinding({
   *   userId: 'user-42',
   *   cardNumber: panFromSecureInput,
   *   cardExpiry: expiryFromSecureInput, // YYMM
   * });
   * showOtpPrompt(`Uzcard/Humo sent a code to ${started.otpSentPhone}`);
   */
  startPanBinding(
    params: StartPanBindingParams,
    options?: PaylovCallOptions,
  ): Promise<PanBindingStarted>;

  /**
   * Confirms a card from {@link CardsResource.startPanBinding} with the cardholder's OTP and
   * returns the bound card, which can still read `isActive: false` with the reason in
   * `processingStatus`: check it before charging. A wrong code, a PINFL mismatch or invalid input
   * leaves the OTP usable, so the cardholder can retry. On Paylov's test environment an OTP lasts
   * about 90 seconds, and the fourth wrong OTP blocks binding of that card for about five
   * minutes, also for another user: `card_is_blocked`, with the rest of the block in
   * `retryAfterSeconds`. A card-number payment counts its own wrong OTPs. Stop prompting before
   * that. Moves no money.
   *
   * Recovery: when `isPaylovOutcomeUnknown(error)`, read `cards.get({ cardId })`. A repeated
   * confirm answering `card_is_already_activated` means the card is already confirmed.
   *
   * @throws {@link PaylovApiError} `invalid_otp`, `otp_expired`, `card_is_blocked`, `try_new_otp`,
   * `too_many_attempts`, `pinfl_not_match`, `card_is_already_activated`, `card_not_found`.
   *
   * @example
   * const card = await paylov.cards.confirmPanBinding({
   *   cardId: started.cardId,
   *   otp: otpFromCardholder,
   * });
   * await userCards.save('user-42', card.cardId);
   */
  confirmPanBinding(params: ConfirmPanBindingParams, options?: PaylovCallOptions): Promise<Card>;

  /**
   * Reads one card with its balance and status. Paylov can answer from a cache: right after a
   * delete it has still returned the deleted card for a short time. Moves no money.
   *
   * @throws {@link PaylovApiError} `card_not_found` (unknown or deleted),
   * `card_not_found_in_processing_center`, `card_is_blocked`,
   * `card_is_blocked_in_processing_center`, `balance_refresh_error`.
   *
   * @example
   * const card = await paylov.cards.get({ cardId: savedCardId });
   * if (!card.isActive) askForAnotherCard(card.processingStatus);
   */
  get(params: GetCardParams, options?: PaylovCallOptions): Promise<Card>;

  /**
   * Lists a merchant user's bound cards; an unknown user has none. One malformed card fails the
   * whole call. Moves no money.
   *
   * @example
   * const cards = await paylov.cards.list({ userId: 'user-42' });
   * const usable = cards.filter((card) => card.isActive);
   */
  list(params: ListCardsParams, options?: PaylovCallOptions): Promise<readonly Card[]>;

  /**
   * Unbinds a card. Moves no money. A repeated delete answers `card_not_found`, which means the
   * card is already gone. `cards.list` and `cards.get` can still return it for a short time.
   * Deleting does not release the card's holds: Paylov's test environment still captured and
   * released holds created before the delete, so release every hold you will not capture.
   *
   * @throws {@link PaylovApiError} `card_not_found`.
   *
   * @example
   * await paylov.cards.delete({ cardId: savedCardId });
   */
  delete(params: DeleteCardParams, options?: PaylovCallOptions): Promise<void>;

  /**
   * Answers whether a phone number is the one linked to a card, as Paylov's `match` reports it.
   * Moves no money.
   *
   * @throws {@link PaylovApiError} `card_not_found`, `permission_denied` (the check is not enabled
   * for the merchant), `phone_not_match`: Paylov documents a mismatch as `false`, yet the
   * development gateway answers this code for every phone, the card's own included, so it does not
   * prove a mismatch.
   *
   * @example
   * const linked = await paylov.cards.checkPhone({ cardId: savedCardId, phoneNumber: verifiedPhone });
   * if (!linked) flagForReview(savedCardId);
   */
  checkPhone(params: CheckCardPhoneParams, options?: PaylovCallOptions): Promise<boolean>;
}

export function createCardsResource(http: HttpClient): CardsResource {
  return {
    async startPanBinding(params, options) {
      const method = 'cards.startPanBinding';
      const { input, signal } = readCall(params, options, method);
      const body = {
        userId: input.string('userId'),
        cardNumber: input.string('cardNumber'),
        expireDate: input.string('cardExpiry'),
        phoneNumber: input.optionalString('phoneNumber'),
      };
      return send(http, ENDPOINTS.startPanBinding, { body, signal }, decodePanBindingStarted);
    },

    async confirmPanBinding(params, options) {
      const method = 'cards.confirmPanBinding';
      const { input, signal } = readCall(params, options, method);
      const body = {
        cardId: input.string('cardId'),
        otp: input.string('otp'),
        cardName: input.optionalString('cardName'),
        pinfl: input.optionalString('pinfl'),
      };
      return send(http, ENDPOINTS.confirmPanBinding, { body, signal }, decodeConfirmedCard);
    },

    async get(params, options) {
      const method = 'cards.get';
      const { input, signal } = readCall(params, options, method);
      const path = { cardId: input.string('cardId') };
      return send(http, ENDPOINTS.get, { path, signal }, decodeFetchedCard);
    },

    async list(params, options) {
      const method = 'cards.list';
      const { input, signal } = readCall(params, options, method);
      const query = { userId: input.string('userId') };
      return send(http, ENDPOINTS.list, { query, signal }, decodeCardList);
    },

    async delete(params, options) {
      const method = 'cards.delete';
      const { input, signal } = readCall(params, options, method);
      const query = { userCardId: input.string('cardId') };
      return send(http, ENDPOINTS.delete, { query, signal }, decodeDeleted);
    },

    async checkPhone(params, options) {
      const method = 'cards.checkPhone';
      const { input, signal } = readCall(params, options, method);
      // The docs name the field `phone`; the gateway requires `phoneNumber`.
      const body = {
        cardId: input.string('cardId'),
        phoneNumber: input.string('phoneNumber'),
      };
      return send(http, ENDPOINTS.checkPhone, { body, signal }, decodeMatch);
    },
  };
}
