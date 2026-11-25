/**
 * Card network as Paylov reports it. Casing may differ between endpoints, so compare
 * case-insensitively.
 */
export type CardVendor = 'Uzcard' | 'Humo' | 'MIR' | (string & {});

/**
 * Processing-center card state. `active` accompanies `isActive: true`; every other value is a
 * block, capture or pending state. The list is open: never match it exhaustively.
 */
export type CardProcessingStatus =
  | 'active'
  | 'call_issuer'
  | 'warm_card'
  | 'do_not_honor'
  | 'honor_with_id'
  | 'not_permitted'
  | 'lost_card_capture'
  | 'stolen_card_capture'
  | 'call_security_capture'
  | 'invalid_card_capture'
  | 'pick_up_card_special_condition'
  | 'call_acquirer_security'
  | 'temporary_blocked_by_user'
  | 'pin_attempts_exceeded'
  | 'forced_pin_change'
  | 'credit_debts'
  | 'unknown'
  | 'pin_activation'
  | 'instant_card_personification_waiting'
  | 'fraud_prevention'
  | 'permanent_blocked_by_client'
  | 'temporary_blocked_by_client'
  | 'decline_restricted_card'
  | 'decline_card_not_effective'
  | 'pick_up_restricted_card'
  | 'pick_up_special_conditions'
  | 'pick_up_lost_card'
  | 'pick_up_stolen_card'
  | 'decline_card_not_active_at_bank_will'
  | 'decline_card_not_active_at_cardholder_will'
  | (string & {});

/** Processing center handling a card. Compare case-insensitively; the list is open. */
export type CardProcessing = 'Uzcard' | 'Humo' | (string & {});

/** A card bound to a merchant user. The card expiry is card data and is not surfaced. */
export interface Card {
  /** Paylov card id; payments and holds charge it. */
  readonly cardId: string;
  /** The merchant user id the card is bound to. */
  readonly userId: string;
  /** Cardholder name from the processing center. Personal data: keep it out of logs. */
  readonly holderName: string;
  /** Merchant-assigned display name; `null` when none was given. */
  readonly cardName: string | null;
  /** First 4 to 6 digits, a `*` mask and the last 4, e.g. `860000******0000`. Never a full PAN. */
  readonly maskedCardNumber: string;
  /** Card balance in tiyin, refreshed from the processing center by `cards.get`. */
  readonly balanceTiyin: number;
  /** Issuing bank id; numeric-looking but a string. */
  readonly bankId: string;
  /** Issuing bank name; `null` when the gateway omits it. */
  readonly bankName: string | null;
  readonly vendor: CardVendor;
  readonly processing: CardProcessing;
  /** The usable flag from the processing center: a card that is not active cannot be charged. */
  readonly isActive: boolean;
  /** The processing center's card state: why the card is not active, or `active` when it is. */
  readonly processingStatus: CardProcessingStatus;
  /** Whether SMS notifications are enabled; without them no OTP reaches the cardholder. */
  readonly isSmsEnabled: boolean;
}

/** Parameters for `cards.startPanBinding`. */
export interface StartPanBindingParams {
  /** The merchant's own user id the card will be bound to. */
  readonly userId: string;
  /**
   * Full card number. PCI scope: the SDK keeps it out of logger events and errors; never log or
   * store it. Paylov answers `validation_error` below 16 characters and `card_not_found` for an
   * unknown card.
   */
  readonly cardNumber: string;
  /** Card expiry as `YYMM`, year first; Paylov answers `validation_error` otherwise. */
  readonly cardExpiry: string;
  /** The phone linked to the card; when given, a different phone fails with `phone_not_match`. */
  readonly phoneNumber?: string;
}

/** Result of `cards.startPanBinding`: the OTP was sent; the card is unusable until confirmed. */
export interface PanBindingStarted {
  /** The card id to confirm; the same id identifies the card once confirmed. */
  readonly cardId: string;
  /**
   * The masked phone the processing center sent the OTP to, for display. The mask differs
   * between sources, so treat it as an opaque string; it is still personal data.
   */
  readonly otpSentPhone: string;
}

/** Parameters for `cards.confirmPanBinding`. */
export interface ConfirmPanBindingParams {
  /** The `cardId` from `cards.startPanBinding`. */
  readonly cardId: string;
  /** The SMS code the cardholder received. Never logged. */
  readonly otp: string;
  /** Display name stored with the card. */
  readonly cardName?: string;
  /**
   * Cardholder PINFL, 14 characters, else `validation_error`; a mismatch fails with
   * `pinfl_not_match`. Personal data.
   */
  readonly pinfl?: string;
}

/** Parameters for `cards.get`. */
export interface GetCardParams {
  readonly cardId: string;
}

/** Parameters for `cards.delete`. */
export interface DeleteCardParams {
  readonly cardId: string;
}

/** Parameters for `cards.list`. */
export interface ListCardsParams {
  /** The merchant's own user id. */
  readonly userId: string;
}

/** Parameters for `cards.checkPhone`. */
export interface CheckCardPhoneParams {
  readonly cardId: string;
  /** E.g. `+998901234567`; Paylov accepts 7 to 15 characters. Personal data. */
  readonly phoneNumber: string;
}
