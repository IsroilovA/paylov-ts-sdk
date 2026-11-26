/** The cards a simulated PAN binding can bind: the processing center's side of the card. */

import type { Card } from '../cards/types.js';
import { isTiyin } from '../core/money.js';

/**
 * The OTP every simulated PAN binding accepts unless its card names another. Paylov's test
 * environment also answers fixed per-card OTPs; production sends a real SMS code.
 */
export const PAYLOV_FAKE_OTP = '111111';

/**
 * Pays and holds a PAN-bound card approves in total without `spendableTiyin`: 1 000 000 000 SUM,
 * the largest hold the simulation answers.
 */
const DEFAULT_SPENDABLE_TIYIN = 100_000_000_000;

/** What `cards.get` reports about a PAN-bound card that the binding does not decide. */
export type PaylovFakePanCardDetails = Partial<
  Pick<Card, 'holderName' | 'balanceTiyin' | 'bankId' | 'bankName' | 'vendor' | 'processing'>
>;

/**
 * A card the simulated processing center knows, so `cards.startPanBinding` and
 * `cards.confirmPanBinding` can bind it. Its full card number stays in memory: the simulation
 * stores a binding by the masked number only, so no two cards may share their first six and last
 * four digits.
 */
export interface PaylovFakePanCard {
  /**
   * The full card number: 16 to 19 digits with a valid Luhn check digit. Use your own test card
   * numbers; a real card number never belongs in a fake.
   */
  readonly cardNumber: string;
  /** `YYMM`; a binding with another well-formed expiry answers `card_not_match`. */
  readonly cardExpiry: string;
  /** The SMS code that confirms the binding. Default {@link PAYLOV_FAKE_OTP}. */
  readonly otp?: string;
  /**
   * The phone linked to the card: a binding that sends another one answers `phone_not_match`.
   * Unset, a binding that sends a phone is unsimulated.
   */
  readonly phoneNumber?: string;
  /**
   * The cardholder PINFL, 14 characters: a confirm that sends another one answers
   * `pinfl_not_match`. Unset, a confirm that sends a PINFL is unsimulated.
   */
  readonly pinfl?: string;
  /**
   * What pays and holds may take from the bound card in total: your assumption, not a Paylov rule.
   * Default 100 000 000 000 (1 000 000 000 SUM).
   */
  readonly spendableTiyin?: number;
  /**
   * What reads report. Defaults: `holderName` `'EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON'`, `balanceTiyin` the
   * `spendableTiyin`, `bankId` `'0'`, `bankName` `null`, `vendor` and `processing` `'Uzcard'`. The
   * balance never decides an approval.
   */
  readonly details?: PaylovFakePanCardDetails;
}

/** A checked {@link PaylovFakePanCard} with its defaults applied. */
export interface PanCard {
  readonly cardNumber: string;
  readonly cardExpiry: string;
  readonly otp: string;
  readonly phoneNumber: string | undefined;
  readonly pinfl: string | undefined;
  readonly spendableTiyin: number;
  readonly maskedCardNumber: string;
  readonly details: Required<PaylovFakePanCardDetails>;
}

/** `YYMM` with a month from 01 to 12, as `createUserCard/` accepts it (W c031, c033). */
const CARD_EXPIRY = /^\d{2}(?:0[1-9]|1[0-2])$/;
const CARD_NUMBER = /^\d{16,19}$/;
const PINFL = /^.{14}$/su;
const MIN_PHONE_LENGTH = 7;

export function isLuhnValid(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits.charAt(digits.length - 1 - index));
    const doubled = index % 2 === 1 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

/** First six and last four digits, as cards report them (W c027). */
export function maskCardNumber(cardNumber: string): string {
  return `${cardNumber.slice(0, 6)}${'*'.repeat(cardNumber.length - 10)}${cardNumber.slice(-4)}`;
}

/** DEV's mask: the first five characters, five `*` and the last two digits (W c025). */
export function maskPhone(phoneNumber: string | undefined): string {
  if (phoneNumber === undefined) return '+9989*****00';
  return `${phoneNumber.slice(0, 5)}*****${phoneNumber.slice(-2)}`;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new TypeError(`${field} must be a non-blank string`);
  }
  return value;
}

function readDetails(
  details: PaylovFakePanCardDetails,
  spendableTiyin: number,
): Required<PaylovFakePanCardDetails> {
  const { balanceTiyin = spendableTiyin } = details;
  if (!isTiyin(balanceTiyin)) {
    throw new TypeError('details.balanceTiyin must be a non-negative safe integer');
  }
  return {
    holderName:
      optionalText(details.holderName, 'details.holderName') ??
      'EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON',
    balanceTiyin,
    bankId: optionalText(details.bankId, 'details.bankId') ?? '0',
    bankName: details.bankName ?? null,
    vendor: optionalText(details.vendor, 'details.vendor') ?? 'Uzcard',
    processing: optionalText(details.processing, 'details.processing') ?? 'Uzcard',
  };
}

export function isCardExpiry(value: string): boolean {
  return CARD_EXPIRY.test(value);
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

/** Checks a card and applies its defaults; throws `TypeError` naming the field, never its value. */
export function readPanCard(card: PaylovFakePanCard): PanCard {
  const { cardNumber, cardExpiry, otp, phoneNumber, pinfl } = card;
  const { spendableTiyin = DEFAULT_SPENDABLE_TIYIN, details = {} } = card;
  if (!matches(cardNumber, CARD_NUMBER) || !isLuhnValid(cardNumber)) {
    throw new TypeError('cardNumber must be 16 to 19 digits with a valid Luhn check digit');
  }
  if (!matches(cardExpiry, CARD_EXPIRY)) {
    throw new TypeError('cardExpiry must be YYMM');
  }
  if ((optionalText(phoneNumber, 'phoneNumber')?.length ?? MIN_PHONE_LENGTH) < MIN_PHONE_LENGTH) {
    throw new TypeError(`phoneNumber must have at least ${MIN_PHONE_LENGTH} characters`);
  }
  if (pinfl !== undefined && !matches(pinfl, PINFL)) {
    throw new TypeError('pinfl must have 14 characters');
  }
  if (!isTiyin(spendableTiyin)) {
    throw new TypeError('spendableTiyin must be a non-negative safe integer');
  }
  return {
    cardNumber,
    cardExpiry,
    otp: optionalText(otp, 'otp') ?? PAYLOV_FAKE_OTP,
    phoneNumber,
    pinfl,
    spendableTiyin,
    maskedCardNumber: maskCardNumber(cardNumber),
    details: readDetails(details, spendableTiyin),
  };
}
