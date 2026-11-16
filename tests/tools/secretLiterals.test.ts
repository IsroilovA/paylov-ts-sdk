import { describe, expect, it } from 'vitest';

import { repositorySecretProblems } from '../../scripts/checkSecrets.mjs';
import { secretProblems, wireFixtureProblems } from '../../scripts/secretLiterals.mjs';

// Constructed canaries, assembled at runtime so this file holds no secret-shaped literal.
const secret = ['synthetic', 'scanner', 'canary'].join('-');
const pan = '8'.repeat(16);
const otp = ['4', '8', '1', '5', '2', '9'].join('');
const person = ['Synthetic', 'Person'].join(' ');
const phone = ['+998', '93', '471', '52', '86'].join('');
const pinfl = ['3120', '3875', '2100', '24'].join('');
const passport = ['AB', '765', '4321'].join('');
const account = ['2020', '8000', '7654', '3210'].join('');
const basic = `Basic ${Buffer.from(['scanner', secret].join(':')).toString('base64')}`;

function json(value: unknown): string[] {
  return secretProblems('fixture.json', JSON.stringify(value));
}

function code(source: string): string[] {
  return secretProblems('sample.ts', source);
}

function wire(body: unknown): string {
  return JSON.stringify({ capture: '042', status: 200, body });
}

const captured = ['9b370dde', 'dfe1', '4365', 'be8a', 'd3581c9479ba'].join('-');
const uuidProblem = ['UUID in a .wire.json must be a synthetic 5eed… id'];

describe('secret scanner', () => {
  it('reads keys from JSON, object properties, class fields and variables', () => {
    for (const property of ['password', '"password"', "'password'"]) {
      expect(code(`const value = { ${property}: ${JSON.stringify(secret)} };`)).toHaveLength(1);
    }
    expect(json({ nested: [{ password: secret }] })).toHaveLength(1);
    expect(code(`const PASSWORD = '${secret}';`)).toHaveLength(1);
    expect(code(`class Config { readonly secret = '${secret}'; }`)).toHaveLength(1);
    expect(secretProblems('fixture.json', '{"pass\\u0077ord":"' + secret + '"}')).toHaveLength(1);
  });

  it('reads template, numeric and asserted literals in code', () => {
    expect(code(`const value = { password: \`${secret}\` };`)).toHaveLength(1);
    expect(code(`const value = { password: '${secret}' as const };`)).toHaveLength(1);
    expect(code(`const value = { otp: ${otp} };`)).toHaveLength(1);
    expect(code(`const value = { cardNumber: ${pan} };`)).toHaveLength(1);
    expect(code('const value = { password: `${fromSecretManager}` };')).toEqual([]);
  });

  it('finds full PANs in card fields, card records and card-history fields, but not masked ones', () => {
    expect(json({ cardNumber: pan })).toHaveLength(1);
    expect(json({ result: { card: { cardId: 'id', number: pan } } })).toHaveLength(1);
    expect(json({ result: { processing: 'humo', data: [{ CARD: pan }] } })).toHaveLength(1);
    expect(json({ result: { processing: 'uzcard', data: [{ hpan: pan }] } })).toHaveLength(1);
    expect(json({ result: { cards: [{ number: pan }] } })).toHaveLength(1);
    expect(code(`const card = { number: '${pan}', expiry: '9912' };`)).toHaveLength(1);
    expect(json({ card: { number: '860000******0000' } })).toEqual([]);
    expect(json({ receipt: { number: pan.slice(1), rrn: pan.slice(1) } })).toEqual([]);
  });

  it('finds Luhn-valid card numbers and tokens in recorded values', () => {
    expect(json({ message: `paid with ${pan}` })).toEqual(['Luhn-valid card number in text']);
    const token = ['abcdefgh12', 'ijklmnop34', 'qrstuvwx56'].join('.');
    expect(json({ echo: token })).toEqual(['JWT-shaped literal']);
    const fixture = ['getBindSession', 'linkAlreadyUsed', 'synthesized'].join('.');
    expect(code(`const file = '${fixture}';`)).toEqual([]);
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJjYW5hcnkifQ', 'c2lnbmF0dXJlLWNhbmFyeQ'];
    expect(code(`const header = 'Bearer ${jwt.join('.')}';`)).toEqual(['JWT-shaped literal']);
  });

  it('accepts personal ids only when masked or synthetic', () => {
    expect(json({ phoneNumber: phone, director_pinfl: pinfl, mobile: phone })).toEqual([
      'phone literal in "phoneNumber" must be masked or synthetic',
      'PINFL literal in "director_pinfl" must be synthetic',
      'phone literal in "mobile" must be masked or synthetic',
    ]);
    expect(json({ otpSentPhone: '+9989*****00', phoneNumber: '+998900000000' })).toEqual([]);
    expect(json({ pinfl: '12345678901234', directorPinfl: '99999999999992' })).toEqual([]);
    expect(json({ externalId: phone, transactionId: pinfl })).toEqual([]);
  });

  it('finds documented sub-merchant director and bank data', () => {
    const organization = {
      director_fio: person,
      director_passport: passport,
      director_birth_date: '1990-01-02',
      account_number: account,
    };
    expect(json({ organization })).toEqual([
      'personal-data literal in "director_fio" must be an explicit placeholder',
      'passport literal in "director_passport" must be synthetic',
      'bank account literal in "account_number" must be synthetic',
    ]);
    expect(
      code(`const org = { directorFullName: '${person}', directorPassport: '${passport}' };`),
    ).toHaveLength(2);
    expect(
      json({
        directorFullName: 'EXAMPLE-DIRECTOR-NOT-A-REAL-PERSON',
        directorPassport: 'ZZ0000000',
        accountNumber: '99999000000000000001',
        directorNationality: 'UZ',
      }),
    ).toEqual([]);
  });

  it('finds literal Basic credentials, but not placeholders or prose', () => {
    expect(code(`const headers = { authorization: '${basic}' };`)).toHaveLength(1);
    expect(code(`new Headers([['authorization', '${basic}']]);`)).toHaveLength(1);
    expect(json({ headers: { Authorization: basic } })).toHaveLength(1);
    expect(secretProblems('page.md', `Authorization: ${basic}`)).toHaveLength(1);
    const placeholder = Buffer.from('LOGIN:EXAMPLE-NOT-A-REAL-PASSWORD').toString('base64');
    expect(code(`const headers = { authorization: 'Basic ${placeholder}' };`)).toEqual([]);
    expect(
      secretProblems('page.md', 'Send a Basic Authorization header; Basic credentials apply.'),
    ).toEqual([]);
    expect(code('const header = `Basic ${encoded}`;')).toEqual([]);
  });

  it('finds cardholder names and credentials in URL queries', () => {
    expect(json({ card: { owner: person } })).toHaveLength(1);
    expect(json({ data: [{ CLIENT: person }] })).toHaveLength(1);
    expect(json({ bindUrl: `https://paylov.uz/card-bind/?token=${secret}` })).toHaveLength(1);
    expect(
      json({ bindUrl: 'https://paylov.uz/card-bind/?token=EXAMPLE-NOT-A-REAL-TOKEN' }),
    ).toEqual([]);
  });

  it('accepts only anchored placeholders', () => {
    for (const value of [
      'EXAMPLE-NOT-A-REAL-PASSWORD',
      'OTP-FROM-SMS',
      '<ACCESS_TOKEN>',
      'pR3x...kLq9',
      '',
    ]) {
      expect(json({ password: value, otp: value, owner: value })).toEqual([]);
    }
    expect(json({ password: ['Hunter', 'PRIVATE', '42'].join('-') })).toHaveLength(1);
    expect(json({ password: ['EXAMPLE', 'NOT', 'A', 'REAL', '7'].join('-') })).toHaveLength(1);
  });

  it('finds credentials that contain spaces', () => {
    const bearer = ['Bearer', secret].join(' ');
    const passphrase = [secret, secret].join(' ');
    expect(code(`const accessToken = '${bearer}';`)).toHaveLength(1);
    expect(code(`const config = { password: '${passphrase}' };`)).toHaveLength(1);
    expect(json({ consumerSecret: passphrase })).toHaveLength(1);
    expect(secretProblems('page.md', `password: '${passphrase}'`)).toHaveLength(1);
  });

  it('leaves short validation probes and validation messages under credential keys alone', () => {
    expect(code("const params = { token: '..' };")).toEqual([]);
    expect(code("const params = { token: 'a/b?c' };")).toEqual([]);
    const messages = {
      token: ['This field is required.'],
      password: ['String should have at least 8 characters'],
    };
    expect(json({ error: { code: 'validation_error', data: messages } })).toEqual([]);
    expect(code(`const data = ${JSON.stringify(messages)};`)).toEqual([]);
    expect(secretProblems('page.md', `Answers \`${JSON.stringify(messages)}\`.`)).toEqual([]);
  });

  it('scans Markdown prose and JSON code fences', () => {
    expect(secretProblems('page.md', `- Token: \`${secret}\``)).toHaveLength(1);
    expect(secretProblems('page.md', `password: '${secret}'`)).toHaveLength(1);
    const fence = ['```json', JSON.stringify({ card: { number: pan } }), '```'].join('\n');
    expect(secretProblems('page.md', fence)).toEqual([
      'full-PAN-shaped literal in "number"',
      'Luhn-valid card number in text',
    ]);
    expect(secretProblems('page.md', `Send \`GET /onboarding/?token=\`; Paylov replies.`)).toEqual(
      [],
    );
  });

  it('scans TypeScript and JavaScript fences with their object context', () => {
    const sample = `const card = { cardId: savedCardId, number: '${pan.slice(1)}' };\nreturn card;`;
    for (const language of ['ts', 'typescript', 'js', 'javascript']) {
      const fence = ['```' + language, sample, '```'].join('\n');
      expect(secretProblems('page.md', fence)).toEqual(['full-PAN-shaped literal in "number"']);
    }
  });

  it('reports categories and keys without the rejected value', () => {
    const problems = json({ password: secret, card: { number: pan.slice(1) } });
    expect(problems).toEqual([
      'credential-shaped literal in "password" must be an explicit placeholder',
      'full-PAN-shaped literal in "number"',
    ]);
    expect(JSON.stringify(problems)).not.toContain(secret);
    expect(code('const = ;')).toContain('source cannot be parsed for scanning');
    expect(secretProblems('x.wire.json', '{')).toEqual([
      'invalid JSON cannot be scanned structurally',
    ]);
  });
});

describe('repository scan', () => {
  it('exempts no section of the README', () => {
    const readme = ['# SDK', '', '## Sandbox', '', `- Token: \`${secret}\``, ''].join('\n');
    expect(repositorySecretProblems(new Map([['README.md', readme]]))).toEqual([
      'README.md: credential-shaped literal in "Token" must be an explicit placeholder',
    ]);
  });

  it('checks recorded UUIDs in .wire.json fixtures only', () => {
    const body = JSON.stringify({ capture: '042', status: 200, body: { id: captured } });
    expect(repositorySecretProblems(new Map([['tests/fixtures/x.docs.json', body]]))).toEqual([]);
    expect(repositorySecretProblems(new Map([['tests/fixtures/x.wire.json', body]]))).toEqual([
      'tests/fixtures/x.wire.json: UUID in a .wire.json must be a synthetic 5eed… id',
    ]);
  });
});

describe('wire fixture UUIDs', () => {
  it('accepts synthetic 5eed UUIDs in any case', () => {
    expect(wireFixtureProblems(wire({ id: '5eed0000-0000-4000-8000-000000000001' }))).toEqual([]);
    expect(wireFixtureProblems(wire({ id: '5EED0000-0000-4000-8000-00000000000A' }))).toEqual([]);
  });

  it('rejects any other UUID, in values, keys and behind JSON escapes, without quoting it', () => {
    const escaped = `\\u00${captured.charCodeAt(0).toString(16)}${captured.slice(1)}`;
    expect(wireFixtureProblems(wire({ transactionId: captured }))).toEqual(uuidProblem);
    expect(wireFixtureProblems(wire({ id: 'x' }).replace('"x"', `"${escaped}"`))).toEqual(
      uuidProblem,
    );
    expect(wireFixtureProblems(wire({ [captured]: true }))).toEqual(uuidProblem);
    expect(JSON.stringify(wireFixtureProblems(wire({ id: captured })))).not.toContain(captured);
    expect(wireFixtureProblems('{')).toEqual([]);
  });
});
