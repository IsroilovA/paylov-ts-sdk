/**
 * What counts as sensitive in Paylov payloads, shared by the probe redactor and the repository
 * secret scanner: field kinds by documented field name, and the value shapes that make a field
 * real data. Each tool decides what to do with a match; neither may keep its own copy of these
 * rules.
 */

/**
 * @typedef {'PAN' | 'expiry' | 'OTP' | 'PINFL' | 'phone' | 'token' | 'credential' | 'login' |
 *   'name' | 'passport' | 'account' | 'date' | 'nationality'} SensitiveKind
 */

/**
 * Field names per kind, matched without case, `_` or `-`, so `card_number`, `cardNumber` and
 * `CARD_NUMBER` are one name. The organization kinds list the documented sub-merchant fields and
 * their SDK names only, so ordinary ids and dates elsewhere stay evidence. `hpan`, `card` and
 * `client` are the card-history fields of Paylov's docs (a full PAN and the cardholder). The SDK
 * does not read card history, but a probe can capture any endpoint, so they stay as a backstop;
 * `card` is anchored so `cardId` stays an id.
 * @type {readonly (readonly [SensitiveKind, RegExp])[]}
 */
const kindNames = [
  ['PAN', /^(?:pan|hpan|card|cardnumber)$/],
  ['expiry', /^(?:expiry|expiration|expiredate|expirationdate|expdate|cardexpiry|cardexpiredate)$/],
  ['OTP', /^(?:otp|smscode|verificationcode|onetimepassword)$/],
  ['PINFL', /pinfl$/],
  ['phone', /(?:phone|phonenumber|mobile|mobilenumber)$/],
  ['token', /token$/],
  ['credential', /(?:password|secret)$/],
  ['login', /(?:consumerkey|username)$/],
  ['name', /^(?:owner|client|cardholder|cardholdername|fullname|directorfio|directorfullname)$/],
  ['passport', /^directorpassport$/],
  ['date', /^(?:directorpassportvalidto|directorbirthdate)$/],
  ['nationality', /^(?:director|dr)nationality(?:for)?(?:uzcard|humo)?$/],
  ['account', /^accountnumber$/],
];

/** Fields that make an object a card record, whose `number` is then a card number. */
const cardRecordKey = /^(?:card_?id|expiry|expiredate|owner)$/i;

/**
 * Whether an object is a card record: its key mentions a card, or it has a card field.
 * @param {readonly string[]} keys the object's own keys
 * @param {string | undefined} holder the key that holds the object
 */
export function isCardRecord(keys, holder) {
  return /card/i.test(holder ?? '') || keys.some((key) => cardRecordKey.test(key));
}

/**
 * The sensitive kind a field holds, by its name; `number` is a PAN inside a card record.
 * @param {string} key @param {boolean} inCardRecord @returns {SensitiveKind | undefined}
 */
export function fieldKind(key, inCardRecord = false) {
  if (inCardRecord && key === 'number') return 'PAN';
  const name = key.replace(/[_-]/g, '').toLowerCase();
  return kindNames.find(([, pattern]) => pattern.test(name))?.[0];
}

/**
 * A credential is eight or more UTF-16 code units, spaces included (`Bearer …`, a passphrase), as
 * `String.length` counts them; Paylov rejects shorter tokens, so shorter values are validation
 * probes. The pattern has no `u` flag so that `.` matches one code unit, not one code point.
 */
const credentialLiteral = /^.{8,}$/s;

/** Numeric kinds are matched with separators removed; text kinds against the raw value. */
const shapes = new Map(
  /** @type {readonly [SensitiveKind, { pattern: RegExp, numeric: boolean }][]} */ ([
    ['PAN', { pattern: /^\d{13,19}$/, numeric: true }],
    ['expiry', { pattern: /^(?:\d{4}|\d{2}\/\d{2})$/, numeric: true }],
    ['OTP', { pattern: /^\d{4,8}$/, numeric: true }],
    ['PINFL', { pattern: /^\d{14}$/, numeric: true }],
    ['phone', { pattern: /^\d{9,15}$/, numeric: true }],
    ['account', { pattern: /^\d+$/, numeric: true }],
    ['token', { pattern: credentialLiteral, numeric: false }],
    ['credential', { pattern: credentialLiteral, numeric: false }],
    ['login', { pattern: credentialLiteral, numeric: false }],
    ['name', { pattern: /\p{L}/u, numeric: false }],
    ['passport', { pattern: /[\p{L}\d]/u, numeric: false }],
    ['date', { pattern: /^\d{4}-\d{2}-\d{2}$/, numeric: false }],
    ['nationality', { pattern: /^[\p{L}\d]{1,3}$/u, numeric: false }],
  ]),
);

/** @param {string} value */
function digitsOf(value) {
  return value.replace(/[\s_()+-]/g, '');
}

/**
 * Whether a trimmed value has the shape of real data of `kind`.
 * @param {SensitiveKind} kind @param {string} value
 */
export function hasSensitiveShape(kind, value) {
  const shape = shapes.get(kind);
  if (shape === undefined) return false;
  return shape.pattern.test(shape.numeric ? digitsOf(value) : value);
}

/**
 * Synthetic test digits: a run of seven identical digits (`+998900000000`, `99999999999992`) or the
 * ascending `123456789`. Masked values (`+9989*****00`) have no full digit shape at all.
 * @param {string} value
 */
export function hasSyntheticDigits(value) {
  return /(\d)\1{6}|123456789/.test(digitsOf(value));
}

/** Full card numbers inside arbitrary text: sixteen digits, confirmed by `isLuhnValid`. */
export const cardNumberInText = /(?<!\d)\d{16}(?!\d)/g;

/** @param {string} digits */
export function isLuhnValid(digits) {
  const sum = [...digits].toReversed().reduce((total, digit, index) => {
    const doubled = index % 2 === 1 ? Number(digit) * 2 : Number(digit);
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return sum % 10 === 0;
}

/** @param {string} text */
export function containsCardNumber(text) {
  return [...text.matchAll(cardNumberInText)].some(([digits]) => isLuhnValid(digits));
}

/**
 * Three dot-separated base64url segments: a JWT or a similar signed token. Recorded data matches it
 * as is; source code and prose also hold dotted names (`get.linkAlreadyUsed.synthesized`), so there
 * only the `eyJ` header that starts every JWT counts.
 */
export const dottedToken = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
export const jwtLiteral = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;
