import { readCall, send } from '../core/call.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { readOtpSms } from '../shared/otpSms.js';
import {
  decodeBindLinkCreated,
  decodeBindSession,
  decodeCardList,
  decodeConfirmedCard,
  decodeFetchedCard,
  decodeMatch,
  decodePanBindingStarted,
  decodeDeleted,
} from './decoders.js';
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

export const ENDPOINTS = {
  createBindLink: {
    method: 'POST',
    route: '/merchant/userCard/createBindLink/',
    shape: 'envelope',
  },
  getBindSession: {
    method: 'GET',
    route: '/merchant/userCard/bindSession/{token}/status/',
    shape: 'envelope',
  },
  startPanBinding: {
    method: 'POST',
    route: '/merchant/userCard/createUserCard/',
    shape: 'envelope',
  },
  confirmPanBinding: {
    method: 'POST',
    route: '/merchant/userCard/confirmUserCardCreate/',
    shape: 'envelope',
  },
  get: { method: 'GET', route: '/merchant/userCard/getCard/{cardId}/', shape: 'envelope' },
  list: {
    method: 'GET',
    route: '/merchant/userCard/getAllUserCards/',
    shape: 'envelope',
  },
  delete: {
    method: 'DELETE',
    route: '/merchant/userCard/deleteUserCard/',
    shape: 'envelope',
  },
  checkPhone: {
    method: 'POST',
    route: '/merchant/userCard/checkPhoneMatch/',
    shape: 'envelope',
  },
} as const;

/** The `paylov.cards` namespace. Nothing here moves money. */
export interface CardsResource {
  /**
   * Starts a Card Bind session, the preferred way to bind a card: the cardholder enters the card
   * and the SMS code on a Paylov page, so the card number never reaches your servers. Open
   * `bindUrl` in a webview; the result arrives through the `card.bind` webhook or
   * {@link CardsResource.getBindSession}. A link binds one card and expires after about 20
   * minutes. Each call creates a new link.
   *
   * @throws {@link PaylovApiError} `permission_denied` when Card Bind is not enabled for the
   * merchant.
   *
   * @example
   * const link = await paylov.cards.createBindLink({
   *   userId: 'user-42',
   *   returnUrl: 'https://app.example/wallet/cards',
   * });
   * await bindSessions.save({ userId: 'user-42', token: link.token, expiresAt: link.expiresAt });
   * openWebView(link.bindUrl);
   */
  createBindLink(
    params: CreateBindLinkParams,
    options?: PaylovCallOptions,
  ): Promise<CardBindLinkCreated>;

  /**
   * Reads a Card Bind session, to recover a bind whose webhook never arrived (Paylov does not
   * retry it). `isBound` is `true` exactly when the card is attached; `card` is the card as it was
   * bound and stays even after the card is deleted, so read {@link CardsResource.get} for its
   * current state. The token stays out of logger events.
   *
   * @throws {@link PaylovApiError} `link_expired` (expired or unknown token; a link that bound a
   * card also answers it once expired, so check `cards.list` before offering a new link),
   * `link_already_used` (a card was already bound with this link: never offer a new one).
   *
   * @example
   * const session = await paylov.cards.getBindSession({ token: storedBindToken });
   * if (session.isBound) await userCards.saveOnce(storedBindToken, session.card.cardId);
   */
  getBindSession(
    params: GetBindSessionParams,
    options?: PaylovCallOptions,
  ): Promise<CardBindSession>;

  /**
   * PCI scope: takes a full card number server-side; the SDK keeps it out of logger events and
   * errors. Prefer {@link CardsResource.createBindLink}, which keeps it off your servers.
   *
   * Registers a card for a user and makes its processing center (Uzcard or Humo) send an OTP to
   * the phone linked to the card; pass the returned `cardId` and the code to
   * {@link CardsResource.confirmPanBinding}. Without SMS notifications on the card no OTP
   * arrives. While the last OTP is still valid, starting again for the same user and card fails
   * with `otp_code_already_sent`; after it expires, a new start sends a new OTP for the same
   * `cardId`.
   *
   * Recovery: when the outcome is unknown, start again; an unconfirmed card is never charged.
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
   * about 90 seconds, and the fourth wrong OTP blocks the card for about five minutes, for
   * bindings and payments alike: `card_is_blocked`, with the rest of the block in
   * `retryAfterSeconds`. Stop prompting before that.
   *
   * Recovery: when the outcome is unknown (`isPaylovOutcomeUnknown`), read
   * `cards.get({ cardId })`. A repeated confirm answering `card_is_already_activated` means the
   * card is already confirmed.
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
   * Reads one card with its balance and status refreshed from the processing center.
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
   * whole call.
   *
   * @example
   * const cards = await paylov.cards.list({ userId: 'user-42' });
   * const usable = cards.filter((card) => card.isActive);
   */
  list(params: ListCardsParams, options?: PaylovCallOptions): Promise<readonly Card[]>;

  /**
   * Unbinds a card. A repeated delete answers `card_not_found`, which means the card is already
   * gone. `cards.list` and `cards.get` can still return it for a short time.
   *
   * @throws {@link PaylovApiError} `card_not_found`.
   *
   * @example
   * await paylov.cards.delete({ cardId: savedCardId });
   */
  delete(params: DeleteCardParams, options?: PaylovCallOptions): Promise<void>;

  /**
   * Answers whether a phone number is the one linked to a card, as Paylov's `match` reports it.
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
    async createBindLink(params, options) {
      const method = 'cards.createBindLink';
      const { input, signal } = readCall(params, options, method);
      const body = { userId: input.string('userId'), returnUrl: input.optionalUrl('returnUrl') };
      return send(http, ENDPOINTS.createBindLink, { body, signal }, decodeBindLinkCreated);
    },

    async getBindSession(params, options) {
      const method = 'cards.getBindSession';
      const { input, signal } = readCall(params, options, method);
      const path = { token: input.string('token') };
      return send(http, ENDPOINTS.getBindSession, { path, signal }, decodeBindSession);
    },

    async startPanBinding(params, options) {
      const method = 'cards.startPanBinding';
      const { input, signal } = readCall(params, options, method);
      const body = {
        userId: input.string('userId'),
        cardNumber: input.string('cardNumber'),
        expireDate: input.string('cardExpiry'),
        phoneNumber: input.optionalString('phoneNumber'),
        sms: input.optionalObject('sms', readOtpSms),
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
