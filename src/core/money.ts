/** Integer-tiyin money guards and converters (1 SUM = 100 tiyin). No float touches an amount. */

import { invalidAmount } from './errors.js';
import { isNonNegativeSafeInteger } from './numbers.js';

const DECIMAL_SUM = /^(\d+)(?:\.(\d{1,2}))?$/;

/** Every public amount and every wire minor-unit amount is a non-negative safe integer. */
const isTiyin: (value: unknown) => value is number = isNonNegativeSafeInteger;

/**
 * Validates a caller amount. `label` prefixes the message (a method context); messages never
 * quote a rejected value.
 */
export function readTiyin(value: unknown, field: string, label: string = field): number {
  if (value === undefined) throw invalidAmount(`${label} is required`, field, 'required');
  if (!isTiyin(value)) {
    throw invalidAmount(`${label} must be a non-negative safe integer`, field, 'type');
  }
  return value;
}

/** A wire SUM amount as tiyin, or `undefined` when it is not a non-negative safe whole SUM. */
export function wireSumToTiyin(sum: unknown): number | undefined {
  if (!isNonNegativeSafeInteger(sum)) return undefined;
  const amountTiyin = sum * 100;
  return Number.isSafeInteger(amountTiyin) ? amountTiyin : undefined;
}

/** A tiyin amount as wire whole SUM, or `undefined` when it is not a whole SUM amount. */
export function tiyinToWireSum(amountTiyin: number): number | undefined {
  return isTiyin(amountTiyin) && amountTiyin % 100 === 0 ? amountTiyin / 100 : undefined;
}

/**
 * Converts SUM to tiyin exactly: a whole-SUM safe integer, or a decimal string with at most two
 * fraction digits. Pass a string for fractional SUM; a fractional number is rejected.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_amount` for a negative, fractional or unsafe
 * number, a malformed string, or a result too large to express in tiyin.
 *
 * @example
 * sumToTiyin(1000);    // 100000
 * sumToTiyin('12.5');  // 1250
 * sumToTiyin(10.5);    // throws PaylovInputError sdk_invalid_amount
 */
export function sumToTiyin(sum: number | string): number {
  if (typeof sum === 'number') {
    const amountTiyin = wireSumToTiyin(sum);
    if (amountTiyin === undefined) {
      throw invalidAmount('sum must be a non-negative whole SUM safe integer', 'sum', 'type');
    }
    return amountTiyin;
  }
  const match = typeof sum === 'string' ? DECIMAL_SUM.exec(sum) : null;
  if (match === null) {
    throw invalidAmount(
      'sum must be a decimal string with at most 2 fraction digits',
      'sum',
      'format',
    );
  }
  const [, whole = '', fraction = ''] = match;
  const amountTiyin = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amountTiyin)) {
    throw invalidAmount('sum is too large to express in tiyin', 'sum', 'range');
  }
  return amountTiyin;
}

/**
 * Formats a tiyin amount for display: ASCII-space thousands, `.` decimals, always two decimals.
 * Locale-independent, so output is identical on every Node ICU build. Never send it on the wire.
 *
 * @throws {@link PaylovInputError} `sdk_invalid_amount` when `amountTiyin` is not a non-negative
 * safe integer, so validate computed values such as balance deltas before display.
 *
 * @example
 * formatSum(2_500_000); // '25 000.00'
 * formatSum(5);         // '0.05'
 */
export function formatSum(amountTiyin: number): string {
  readTiyin(amountTiyin, 'amountTiyin');
  // String slicing, not division: no float ever touches the amount.
  const digits = String(amountTiyin).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${whole}.${digits.slice(-2)}`;
}
