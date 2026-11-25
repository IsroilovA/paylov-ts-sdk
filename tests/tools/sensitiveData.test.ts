import { describe, expect, it } from 'vitest';

import {
  containsCardNumber,
  fieldKind,
  hasSensitiveShape,
  hasSyntheticDigits,
  isCardRecord,
  type SensitiveKind,
} from '../../scripts/sensitiveData.mjs';

describe('field kinds', () => {
  it.each<[SensitiveKind, readonly string[]]>([
    ['PAN', ['pan', 'cardNumber', 'card_number', 'hpan', 'CARD', 'card']],
    ['expiry', ['expiry', 'expireDate', 'expire_date', 'cardExpiry']],
    ['OTP', ['otp', 'OTP', 'smsCode', 'verification_code']],
    ['PINFL', ['pinfl', 'director_pinfl', 'directorPinfl']],
    ['phone', ['phone', 'phoneNumber', 'phone_number', 'otpSentPhone', 'mobile', 'mobileNumber']],
    ['token', ['token', 'access_token', 'bindToken', 'refreshToken']],
    ['credential', ['password', 'consumerSecret', 'consumer_secret', 'CALLBACK_PASSWORD']],
    ['login', ['username', 'consumer_key', 'consumerKey']],
    ['name', ['owner', 'CLIENT', 'cardholderName', 'fullName', 'director_fio', 'directorFullName']],
    ['passport', ['director_passport', 'directorPassport']],
    ['date', ['director_birth_date', 'directorBirthDate', 'director_passport_valid_to']],
    [
      'nationality',
      ['director_nationality', 'dr_nationality_for_humo', 'directorNationalityUzcard'],
    ],
    ['account', ['account_number', 'accountNumber']],
  ])('classifies %s fields by their documented names', (kind, keys) => {
    for (const key of keys) expect(fieldKind(key), key).toBe(kind);
  });

  it('leaves ordinary fields and ids unclassified', () => {
    for (const key of [
      'number',
      'name',
      'legal_name',
      'birthDate',
      'passport',
      'nationality',
      'accountId',
      'cardId',
      'card_id',
      'clientId',
      'externalId',
      'otpStatus',
      'expires_in',
    ]) {
      expect(fieldKind(key), key).toBeUndefined();
    }
  });

  it('reads `number` as a PAN only inside a card record', () => {
    expect(isCardRecord(['cardId', 'number'], undefined)).toBe(true);
    expect(isCardRecord(['number', 'expireDate'], undefined)).toBe(true);
    expect(isCardRecord(['number'], 'cards')).toBe(true);
    expect(isCardRecord(['number', 'rrn'], 'receipt')).toBe(false);
    expect(fieldKind('number', true)).toBe('PAN');
  });
});

describe('value shapes', () => {
  it.each<[SensitiveKind, readonly string[], readonly string[]]>([
    [
      'PAN',
      ['8600 1234 5678 9012', '8600123456789012345'],
      ['860012345678', '8600 **** **** 9012'],
    ],
    ['OTP', ['1234', '12345678'], ['123', 'ok']],
    ['PINFL', ['3120-3875-2100-24'], ['3120387521002', '3120 3875 2100 2']],
    ['phone', ['+998 93 471 52 86'], ['+9989*****00', '12345678']],
    ['token', ['abcdefgh', 'Bearer abcdefghijklmnop', 'hunter2 hunter2'], ['abcdefg', 'a/b c']],
    ['name', ['Синтетик Шахс'], ['', '42']],
    ['passport', ['AB7654321'], ['', '--']],
    ['account', ['20208000765432'], ['2020 800x']],
    ['date', ['1990-01-02'], ['1990', '2026-11-12T21:11:50']],
    ['nationality', ['UZ', '860'], ['UZBK', '']],
  ])('recognizes real-shaped %s values', (kind, real, other) => {
    for (const value of real) expect(hasSensitiveShape(kind, value), value).toBe(true);
    for (const value of other) expect(hasSensitiveShape(kind, value), value).toBe(false);
  });

  it('accepts seven repeated digits or the ascending 123456789 as synthetic', () => {
    for (const value of ['88888888888888', '+998900000000', 'ZZ0000000', '12345678901234']) {
      expect(hasSyntheticDigits(value), value).toBe(true);
    }
    for (const value of ['31203875210024', '+998934715286', 'AB7654321']) {
      expect(hasSyntheticDigits(value), value).toBe(false);
    }
  });

  it('finds Luhn-valid sixteen-digit card numbers in text', () => {
    expect(containsCardNumber(`paid with ${'8'.repeat(16)}.`)).toBe(true);
    expect(containsCardNumber('1234567812345678')).toBe(false);
    expect(containsCardNumber(`id ${'8'.repeat(17)}`)).toBe(false);
  });
});
