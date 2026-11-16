import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeCapture } from '../../scripts/probes/captures.mjs';
import {
  captureDirectory,
  outsideRepository,
  repositoryRoot,
} from '../../scripts/probes/paths.mjs';
import { openProbe, withProbe } from '../../scripts/probes/probe.mjs';
import { loadRedactor, Redactor } from '../../scripts/probes/redaction.mjs';
import { scanCaptureSources } from '../../scripts/probes/scanCaptures.mjs';
import { assertDevUrl, parseTestCards, readSandboxConfig } from '../../scripts/sandboxConfig.mjs';
import { createFakeFetch, type FakeResponseSpec } from '../helpers/fakeFetch.js';

vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve()),
}));

const personPlaceholder = '<personal name>';
const passportPlaceholder = '<passport>';
const canary = 'EXAMPLE-PROBE-NOT-A-REAL-CREDENTIAL';
const cardPan = '8'.repeat(16);
const expiry = '9912';
const otp = '8'.repeat(6);
const pinfl = '8'.repeat(14);
const phone = '+998' + '8'.repeat(9);
const accessToken = 'EXAMPLE-ACCESS-NOT-A-REAL-TOKEN';
const refreshToken = 'EXAMPLE-REFRESH-NOT-A-REAL-TOKEN';
const jwt = ['EXAMPLEJWT', 'NOTAREALTOKEN', 'CANARYONLY'].join('.');
/** Deliberately wrong values a probe may send; they are on no secret list. */
const wrongOtp = '0'.repeat(6);
const wrongPassword = 'EXAMPLE-WRONG-NOT-A-REAL-PASSWORD';
const unlistedCredential = '<credential-like value not on the secret list>';
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'paylov-probes-'));
  vi.stubEnv('PAYLOV_BASE_URL', 'https://dev.gw.paylov.uz');
  for (const name of [
    'PAYLOV_CONSUMER_KEY',
    'PAYLOV_CONSUMER_SECRET',
    'PAYLOV_USERNAME',
    'PAYLOV_PASSWORD',
  ]) {
    vi.stubEnv(name, canary);
  }
  vi.stubEnv('PAYLOV_LIVE_TEST_CARDS', `${cardPan}:${expiry}:${otp}`);
  vi.stubEnv('PAYLOV_PROBE_SECRETS_FILE', undefined);
  vi.stubEnv('PAYLOV_CAPTURE_DIR', directory);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

function fake(script: FakeResponseSpec[]): ReturnType<typeof createFakeFetch> {
  const fetchImpl = createFakeFetch(script);
  vi.stubGlobal('fetch', fetchImpl);
  return fetchImpl;
}

async function captures(): Promise<Record<string, unknown>[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).toSorted();
  const sources = await Promise.all(names.map((name) => readFile(join(directory, name), 'utf8')));
  return sources.map((source) => JSON.parse(source) as Record<string, unknown>);
}

describe('shared DEV configuration', () => {
  it('preserves trimmed credentials, origin normalization and live skip messages', () => {
    vi.stubEnv('PAYLOV_USERNAME', `  ${canary}  `);
    vi.stubEnv('PAYLOV_BASE_URL', 'https://dev.gw.paylov.uz/merchant/');
    expect(readSandboxConfig()).toMatchObject({
      baseUrl: 'https://dev.gw.paylov.uz',
      username: canary,
    });
    vi.stubEnv('PAYLOV_BASE_URL', undefined);
    expect(readSandboxConfig()).toBe('PAYLOV_BASE_URL is not set');
    vi.stubEnv('PAYLOV_BASE_URL', 'invalid');
    expect(readSandboxConfig()).toBe('PAYLOV_BASE_URL is not a URL');
    vi.stubEnv('PAYLOV_BASE_URL', 'https://dev.gw.paylov.uz');
    vi.stubEnv('PAYLOV_PASSWORD', ' ');
    expect(readSandboxConfig()).toBe('missing PAYLOV_PASSWORD');
  });

  it.each([
    'https://gw2.paylov.uz',
    'http://dev.gw.paylov.uz',
    'https://dev.gw.paylov.uz:444',
    'https://dev.gw.paylov.uz.evil.example',
    'https://dev.app.paylov.uz',
    'blob:https://dev.gw.paylov.uz/canary',
  ])('refuses unsafe REST origin %s', (url) => {
    expect(() => {
      assertDevUrl(new URL(url));
    }).toThrow('refused');
    vi.stubEnv('PAYLOV_BASE_URL', url);
    expect(readSandboxConfig()).toBe(
      'PAYLOV_BASE_URL must be https://dev.gw.paylov.uz; any other host is refused',
    );
  });

  it('parses test cards and rejects malformed entries without quoting them', () => {
    const humo = `${'9'.repeat(16)}:${expiry}:${'9'.repeat(4)}`;
    expect(parseTestCards(` ${cardPan}:${expiry}:${otp} ; ${humo}`)).toEqual([
      { pan: cardPan, expiry, otp },
      { pan: '9'.repeat(16), expiry, otp: '9'.repeat(4) },
    ]);
    for (const value of [`${cardPan}:${expiry}`, `${cardPan}:${expiry}:${otp};`, `${cardPan}x`]) {
      expect(parseTestCards(value)).toBe('PAYLOV_LIVE_TEST_CARDS is malformed');
    }
  });

  it('permits only the exact DEV GraphQL endpoint and rejects URL credentials', () => {
    expect(() => {
      assertDevUrl(new URL('https://dev.app.paylov.uz/graphql/'), 'graphql');
    }).not.toThrow();
    for (const url of [
      'https://dev.app.paylov.uz/graphql',
      'https://app.paylov.uz/graphql/',
      'https://dev.app.paylov.uz/graphql/?x=1',
    ]) {
      expect(() => {
        assertDevUrl(new URL(url), 'graphql');
      }).toThrow('refused');
    }
    expect(() => {
      assertDevUrl(new URL(`https://${canary}@dev.gw.paylov.uz`));
    }).toThrow('refused');
  });
});

describe('probe redaction', () => {
  it('redacts known and discovered secrets, consistently maps ids, and preserves evidence values', async () => {
    const redactor = await loadRedactor();
    redactor.register('EXAMPLE-EXTRA-NOT-A-REAL-SECRET', '<extra>');
    const body = {
      copied: `PAN ${cardPan} expiry ${expiry} OTP ${otp}`,
      credentials: canary,
      nested: [
        {
          cardId: 'EXAMPLE-CARD-NOT-A-REAL-ID',
          transactionId: 'EXAMPLE-TX-NOT-A-REAL-ID',
          userId: 'EXAMPLE-USER-NOT-A-REAL-ID',
          merchantId: 'EXAMPLE-MERCHANT-NOT-A-REAL-ID',
          cardNumber: cardPan,
          expireDate: expiry,
          otp,
          pinfl,
          phone,
          owner: 'EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON',
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      ],
      echo: accessToken,
      extra: 'EXAMPLE-EXTRA-NOT-A-REAL-SECRET',
      amount: 9912,
      expires_in: 3600,
      otpStatus: 'ok',
      code: 'ok',
      status: 'paid',
      enabled: true,
      ts: '2099-12-01T00:00:00Z',
    };
    redactor.learn(body);
    const cleaned = redactor.clean(body);
    expect(cleaned).toMatchObject({
      copied: 'PAN <test card PAN> expiry <test card expiry> OTP <test card OTP>',
      credentials: '<credential>',
      echo: '<token>',
      extra: '<extra>',
      nested: [
        {
          cardId: '<card A>',
          transactionId: '<tx 1>',
          userId: '<user 1>',
          cardNumber: '<test card PAN>',
          expireDate: '<test card expiry>',
          otp: '<test card OTP>',
          pinfl: '<PINFL not on the secret list>',
          phone: '<phone not on the secret list>',
          owner: personPlaceholder,
        },
      ],
      amount: 9912,
      expires_in: 3600,
      otpStatus: 'ok',
      code: 'ok',
      status: 'paid',
      enabled: true,
      ts: '2099-12-01T00:00:00Z',
    });
    expect(redactor.id('EXAMPLE-CARD-NOT-A-REAL-ID', 'card')).toBe('<card A>');
    expect(redactor.id('EXAMPLE-OTHER-CARD-NOT-A-REAL-ID', 'card')).toBe('<card B>');
    redactor.id('card-a', 'card');
    expect(redactor.clean({ echo: 'card-a' })).toEqual({ echo: '<card C>' });
    expect(redactor.scan(JSON.stringify(cleaned)).hits).toEqual([]);
  });

  it('refuses to load with a malformed test card list', async () => {
    vi.stubEnv('PAYLOV_LIVE_TEST_CARDS', `${cardPan}:${expiry}`);
    await expect(loadRedactor()).rejects.toThrow('PAYLOV_LIVE_TEST_CARDS is malformed');
  });

  it('redacts documented sub-merchant director and bank fields, in their own fields only', async () => {
    const organization = {
      name: 'Example Shop LLC',
      director_fio: ['Review', 'Example', 'Person'].join(' '),
      director_passport: ['AB', '765', '4321'].join(''),
      director_passport_valid_to: '2030-01-02',
      director_birth_date: '1990-01-02',
      director_nationality: 'UZ',
      account_number: ['2020', '8000', '7654', '3210', '9876'].join(''),
      oked: '47190',
      mfo: '00014',
    };
    const capture = {
      request: { body: { name: 'Shop', organization } },
      response: { body: { result: { name: 'Shop', bank: 'UZCARD', ts: '1990-01-02T00:00:00' } } },
    };
    expect(new Redactor().scan(JSON.stringify(capture)).hits).toEqual([
      { kind: 'name', count: 1 },
      { kind: 'passport', count: 1 },
      { kind: 'date', count: 2 },
      { kind: 'nationality', count: 1 },
      { kind: 'account', count: 1 },
    ]);
    const redactor = await loadRedactor();
    redactor.learn(capture);
    expect(redactor.clean(capture)).toEqual({
      request: {
        body: {
          name: 'Shop',
          organization: {
            name: 'Example Shop LLC',
            director_fio: personPlaceholder,
            director_passport: passportPlaceholder,
            director_passport_valid_to: '<personal date>',
            director_birth_date: '<personal date>',
            director_nationality: '<nationality>',
            account_number: '<bank account>',
            oked: '47190',
            mfo: '00014',
          },
        },
      },
      response: capture.response,
    });
  });

  it('maps the cid that bind start returns to the same placeholder as cardId', async () => {
    const redactor = await loadRedactor();
    const started = { result: { cid: 'EXAMPLE-CARD-NOT-A-REAL-ID' } };
    const confirmed = { body: { cardId: 'EXAMPLE-CARD-NOT-A-REAL-ID' } };
    redactor.learn(started);
    expect(redactor.clean(started)).toEqual({ result: { cid: '<card A>' } });
    expect(redactor.clean(confirmed)).toEqual({ body: { cardId: '<card A>' } });
  });

  it('finds Luhn PANs and JWTs in arbitrary strings, but preserves unrelated short values', async () => {
    const redactor = await loadRedactor();
    const source = JSON.stringify({
      message: `CANARY ${cardPan} ${expiry} ${otp} ${jwt}`,
      amount: 9912,
      id: `external-${otp}`,
      time: '2099-12-01',
      unrelated: '1234567812345678',
    });
    const result = redactor.scan(source);
    expect(JSON.parse(result.text)).toEqual({
      message: 'CANARY <test card PAN> <test card expiry> <test card OTP> <token>',
      amount: 9912,
      id: `external-${otp}`,
      time: '2099-12-01',
      unrelated: '1234567812345678',
    });
    expect(result.hits).toEqual(
      expect.arrayContaining([
        { kind: 'PAN', count: 1 },
        { kind: 'JWT', count: 1 },
      ]),
    );
  });

  it('recognizes escaped secrets, contextual numeric values and incomplete historical secret lists', async () => {
    const redactor = await loadRedactor();
    const source = JSON.stringify({
      message: cardPan,
      expireDate: 9912,
      otp: Number(otp),
      phone,
      pinfl,
    }).replace(cardPan, '\\u0038' + cardPan.slice(1));
    const result = redactor.scan(source);
    expect(JSON.parse(result.text)).toEqual({
      message: '<test card PAN>',
      expireDate: '<test card expiry>',
      otp: '<test card OTP>',
      phone: '<phone not on the secret list>',
      pinfl: '<PINFL not on the secret list>',
    });
    expect(redactor.scan(result.text).hits).toEqual([]);
  });

  it('never labels an unlisted value as the test-card value and keeps validation messages', async () => {
    const redactor = await loadRedactor();
    const capture = {
      request: { body: { otp: wrongOtp, password: wrongPassword } },
      response: {
        body: {
          result: null,
          error: {
            code: 'validation_error',
            data: {
              token: ['This field is required.'],
              username: ['String should have at least 8 characters'],
            },
          },
        },
      },
    };
    redactor.learn(capture);
    expect(redactor.clean(capture)).toEqual({
      request: {
        body: {
          otp: '<OTP not on the secret list>',
          password: unlistedCredential,
        },
      },
      response: capture.response,
    });
    const historical = { ...capture.response, otp: wrongOtp };
    expect(JSON.parse(redactor.scan(JSON.stringify(historical)).text)).toEqual({
      ...capture.response,
      otp: '<OTP not on the secret list>',
    });
  });

  it('redacts card-record numbers without treating receipt numbers or expiry timestamps as card data', async () => {
    const redactor = await loadRedactor();
    const value = {
      cards: [{ number: cardPan }],
      receipt: { number: 'canary-receipt' },
      expires_in: 3600,
      expiresAt: '2099-12-01',
      otpStatus: 'ok',
    };
    redactor.learn(value);
    expect(redactor.clean(value)).toEqual({
      cards: [{ number: '<test card PAN>' }],
      receipt: { number: 'canary-receipt' },
      expires_in: 3600,
      expiresAt: '2099-12-01',
      otpStatus: 'ok',
    });
  });

  it('fails closed on secrets hidden in field names while preserving ordinary field names', async () => {
    const redactor = await loadRedactor();
    await expect(
      writeCapture(directory, 'keyLeak', { [cardPan]: 'canary' }, redactor),
    ).rejects.toThrow('capture rejected: PAN');
    expect(await readdir(directory)).toEqual([]);
    expect(redactor.scan(JSON.stringify({ [cardPan]: 'canary' })).text).toBe(
      '{"<test card PAN>":"canary"}',
    );
  });

  it.each(['registered secret', 'PAN', 'JWT', 'expiry', 'OTP'])(
    'deletes a capture if the final scan finds %s',
    async (kind) => {
      const redactor = await loadRedactor();
      redactor.register('EXAMPLE-EXTRA-NOT-A-REAL-SECRET', '<extra>');
      const bodies: Record<string, unknown> = {
        'registered secret': { message: 'EXAMPLE-EXTRA-NOT-A-REAL-SECRET' },
        PAN: { message: cardPan },
        JWT: { message: jwt },
        expiry: { expireDate: expiry },
        OTP: { otp },
      };
      vi.spyOn(redactor, 'clean').mockImplementation((value) => value);
      await expect(writeCapture(directory, 'failClosed', bodies[kind], redactor)).rejects.toThrow(
        `capture rejected: ${kind}`,
      );
      expect(await readdir(directory)).toEqual([]);
    },
  );
});

describe('capture storage', () => {
  it('refuses repository paths and symlinks before creating directories', async () => {
    await expect(captureDirectory(undefined)).rejects.toThrow('required');
    await expect(captureDirectory(repositoryRoot)).rejects.toThrow('outside');
    await expect(captureDirectory(join(repositoryRoot, 'captureCanary', 'nested'))).rejects.toThrow(
      'outside',
    );
    const link = join(directory, 'checkout');
    await symlink(repositoryRoot, link);
    await expect(outsideRepository(join(link, 'captureCanary'))).rejects.toThrow('outside');
    expect(await captureDirectory(join(directory, 'valid'))).toContain('valid');
    expect(await outsideRepository(dirname(repositoryRoot))).toBe(dirname(repositoryRoot));
  });

  it('claims unique global numbers across concurrent labels without overwriting earlier captures', async () => {
    const redactor = new Redactor();
    const existing = '{"existing":true}\n';
    await writeFile(join(directory, '005_existing.json'), existing);
    const paths = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        writeCapture(
          directory,
          `parallel-${index}`,
          { response: { status: 200, body: { index } } },
          redactor,
        ),
      ),
    );
    const numbers = paths.map((path) => Number(basename(path).split('_')[0]));
    expect(new Set(numbers).size).toBe(24);
    expect(Math.min(...numbers)).toBe(6);
    expect(await readFile(join(directory, '005_existing.json'), 'utf8')).toBe(existing);
    expect(await readdir(directory)).toHaveLength(25);
  });
});

describe('raw probe lifecycle', () => {
  it('shares one lazy grant and records raw requests, query placeholders and selected headers', async () => {
    const fetchImpl = fake([
      { body: { access_token: accessToken, refresh_token: refreshToken } },
      {
        body: { result: { cardId: 'EXAMPLE-CARD-NOT-A-REAL-ID', access_token: accessToken } },
        headers: { 'retry-after': '3', 'x-safe': 'yes', 'x-discard': 'no' },
      },
      { body: [] },
    ]);
    const probe = await openProbe({ label: 'rawRead' });
    expect(fetchImpl.calls).toHaveLength(0);
    await Promise.all([
      probe.rest('POST', '/merchant/unusual/', {
        query: { cardNumber: cardPan },
        body: { amount: -7, cardNumber: cardPan, expireDate: expiry },
        keepHeaders: ['x-safe'],
      }),
      probe.rest('GET', '/merchant/bankList/'),
    ]);
    await probe.close();
    expect(fetchImpl.calls).toHaveLength(3);
    expect(fetchImpl.calls[0]).toMatchObject({
      url: 'https://dev.gw.paylov.uz/merchant/oauth2/token/',
      body: { grant_type: 'password', username: canary, password: canary },
    });
    expect(fetchImpl.calls[1]).toMatchObject({
      body: { amount: -7, cardNumber: cardPan, expireDate: expiry },
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const recorded = await captures();
    expect(recorded).toHaveLength(3);
    const call = recorded.find((item) => JSON.stringify(item).includes('/unusual/'));
    expect(call).toMatchObject({
      environment: 'DEV',
      request: {
        method: 'POST',
        auth: 'bearer',
        body: { amount: -7, cardNumber: '<test card PAN>' },
      },
      response: { status: 200, headers: { 'retry-after': '3', 'x-safe': 'yes' } },
    });
    expect(JSON.stringify(call)).toContain('query+value');
    expect(JSON.stringify(recorded)).not.toContain('x-discard');
    for (const value of [canary, cardPan, accessToken, refreshToken])
      expect(JSON.stringify(recorded)).not.toContain(value);
  });

  it('supersedes the shared grant and sends a chosen bearer token without recording it', async () => {
    const newAccess = 'EXAMPLE-NEW-ACCESS-NOT-A-REAL-TOKEN';
    const newRefresh = 'EXAMPLE-NEW-REFRESH-NOT-A-REAL-TOKEN';
    const fetchImpl = fake([
      { body: { access_token: accessToken, refresh_token: refreshToken } },
      { body: { access_token: newAccess, refresh_token: newRefresh } },
      { status: 401, body: { result: null, error: { code: 'permission_denied' } } },
      { body: [] },
    ]);
    const probe = await openProbe({ label: 'supersede' });
    const superseded = await probe.supersedeToken();
    await probe.rest('POST', '/merchant/payment/hold/create/', { auth: { bearer: superseded } });
    await probe.rest('GET', '/merchant/bankList/');
    await probe.close();

    expect(superseded).toBe(accessToken);
    expect(fetchImpl.calls[1]).toMatchObject({
      body: { grant_type: 'refresh_token', refresh_token: refreshToken },
    });
    expect(fetchImpl.calls[2]).toMatchObject({
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(fetchImpl.calls[3]).toMatchObject({ headers: { authorization: `Bearer ${newAccess}` } });
    const recorded = JSON.stringify(await captures());
    expect(recorded).toContain('"auth":"chosen bearer"');
    for (const value of [accessToken, refreshToken, newAccess, newRefresh])
      expect(recorded).not.toContain(value);
  });

  it('does not retry failed grants, even on later calls', async () => {
    const fetchImpl = fake([{ status: 401, body: { error: { code: 'invalid_grant' } } }]);
    const probe = await openProbe({ label: 'failedGrant' });
    await expect(probe.rest('GET', '/merchant/bankList/')).rejects.toThrow(
      'password grant failed (HTTP 401)',
    );
    await expect(probe.rest('GET', '/merchant/bankList/')).rejects.toThrow('no further grant');
    expect(fetchImpl.calls).toHaveLength(1);
    await probe.close();
  });

  it('retries a grant once after a 429 and keeps the retry response as evidence', async () => {
    const fetchImpl = fake([
      { status: 429, headers: { 'retry-after': '0' } },
      { body: { access_token: accessToken } },
      { body: [] },
    ]);
    await withProbe('rateLimit', async (probe) => {
      await probe.rest('GET', '/merchant/bankList/');
    });
    expect(fetchImpl.calls).toHaveLength(3);
    expect((await captures()).map((item) => item['response'])).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 429 })]),
    );
  });

  it.each([
    [undefined, 60_000],
    ['2', 2_000],
    ['invalid', 60_000],
  ])('honors Retry-After %s and permits no third grant', async (retryAfter, expectedDelay) => {
    const headers = retryAfter === undefined ? {} : { 'retry-after': retryAfter };
    const fetchImpl = fake([
      { status: 429, headers },
      { status: 429, headers },
    ]);
    const probe = await openProbe({ label: 'grantCooldown' });
    await expect(probe.rest('GET', '/merchant/bankList/')).rejects.toThrow('HTTP 429');
    await expect(probe.rest('GET', '/merchant/bankList/')).rejects.toThrow('HTTP 429');
    expect(delay).toHaveBeenCalledExactlyOnceWith(expectedDelay);
    expect(fetchImpl.calls).toHaveLength(2);
    await probe.close();
  });

  it('refuses host escapes before sending and never follows redirects', async () => {
    const fetchImpl = fake([{ status: 302, headers: { location: 'https://gw2.paylov.uz/' } }]);
    const checked = vi.fn<typeof fetchImpl>(fetchImpl);
    vi.stubGlobal('fetch', checked);
    const probe = await openProbe({ label: 'hostGate' });
    await expect(probe.rest('GET', 'https://gw2.paylov.uz/', { auth: 'none' })).rejects.toThrow(
      'refused',
    );
    await expect(probe.rest('GET', '//gw2.paylov.uz/', { auth: 'none' })).rejects.toThrow(
      'refused',
    );
    await expect(probe.rest('GET', `http://[${cardPan}]`, { auth: 'none' })).rejects.toThrow(
      'probe path is not a valid URL',
    );
    expect(fetchImpl.calls).toHaveLength(0);
    await probe.rest('GET', '/merchant/status/', { auth: 'none' });
    expect(checked.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
    expect(fetchImpl.calls).toHaveLength(1);
    await probe.close();
    await expect(probe.rest('GET', '/')).rejects.toThrow('closed');
  });

  it('uses credential-free GraphQL and cleans all tracked resources after a thrown probe', async () => {
    const fetchImpl = fake([
      { body: { data: { ok: true } } },
      { body: { access_token: accessToken } },
      { status: 500 },
      { body: { result: true, error: null } },
    ]);
    await expect(
      withProbe('cleanup', async (probe) => {
        probe.track.card('EXAMPLE-CARD-NOT-A-REAL-ID');
        probe.track.hold('EXAMPLE-HOLD-NOT-A-REAL-ID');
        await probe.graphql({
          query: 'query Check { status }',
          operationName: 'Check',
          variables: { amount: -1 },
        });
        throw new Error('canary probe failure');
      }),
    ).rejects.toThrow('probe cleanup: hold HTTP 500');
    expect(fetchImpl.calls).toHaveLength(4);
    expect(fetchImpl.calls[0]).toMatchObject({
      url: 'https://dev.app.paylov.uz/graphql/',
      headers: { 'content-type': 'application/json' },
    });
    expect(fetchImpl.calls[0]?.headers).not.toHaveProperty('authorization');
    expect(fetchImpl.calls[2]).toMatchObject({
      method: 'POST',
      body: { transactionId: 'EXAMPLE-HOLD-NOT-A-REAL-ID' },
    });
    expect(fetchImpl.calls[3]).toMatchObject({
      method: 'DELETE',
      url: 'https://dev.gw.paylov.uz/merchant/userCard/deleteUserCard/?userCardId=EXAMPLE-CARD-NOT-A-REAL-ID',
    });
  });
});

describe('capture scanner', () => {
  it('fixes secret literals only, preserves bytes and ignores short values in amounts, dates and ids', async () => {
    const secrets = join(directory, 'canarySecrets.txt');
    await writeFile(
      secrets,
      `pan=${cardPan}\nexpiry=${expiry} # YYMM comment\notp=${otp}\npinfl=${pinfl}\nphone=${phone}\n`,
    );
    vi.stubEnv('PAYLOV_PROBE_SECRETS_FILE', secrets);
    const redactor = await loadRedactor();
    const name = '001_canary.json';
    const source = `{
  "message" : "${cardPan} ${expiry} ${otp}",
  "expiry": ${expiry}, "otp": "${otp}", "pinfl": "${pinfl}", "phone": "${phone}",
  "credential": "${canary}", "jwt": "${jwt}",
  "amount": ${expiry}, "timestamp": "2099-12-01", "id": "id-${otp}", "escape": "\\u0061"
}\n`;
    const before = scanCaptureSources(new Map([[name, source]]), redactor, false);
    expect(before.status).toBe(1);
    expect(before.lines[0]).toMatch(/^001_canary\.json: \w/);
    expect(before.fixes.size).toBe(0);
    for (const value of [cardPan, expiry, otp, pinfl, phone, canary, jwt])
      expect(before.lines.join('\n')).not.toContain(value);

    const fixed = scanCaptureSources(new Map([[name, source]]), redactor, true);
    expect(fixed.status).toBe(0);
    expect(fixed.lines[0]).toMatch(/ fixed$/);
    const expected = source
      .replace(
        `"${cardPan} ${expiry} ${otp}"`,
        '"<test card PAN> <test card expiry> <test card OTP>"',
      )
      .replace(`"expiry": ${expiry}`, '"expiry": "<test card expiry>"')
      .replace(`"otp": "${otp}"`, '"otp": "<test card OTP>"')
      .replace(pinfl, '<test PINFL>')
      .replace(phone, '<test phone>')
      .replace(canary, '<credential>')
      .replace(jwt, '<token>');
    expect(fixed.fixes).toEqual(new Map([[name, expected]]));
    expect(scanCaptureSources(new Map([[name, expected]]), redactor, false)).toEqual({
      lines: ['files=0; hits=0'],
      fixes: new Map(),
      status: 0,
    });
    expect(JSON.parse(expected)).toMatchObject({
      amount: 9912,
      timestamp: '2099-12-01',
      id: `id-${otp}`,
      escape: 'a',
    });
  });

  it('reports a capture it cannot parse without quoting it and scans the rest', () => {
    const sources = new Map([
      ['001_broken.json', `{"pan": "${cardPan}"`],
      ['002_leak.json', JSON.stringify({ message: cardPan })],
    ]);
    const { lines, status } = scanCaptureSources(sources, new Redactor(), false);
    expect(lines).toEqual([
      '001_broken.json: capture is not valid JSON',
      '002_leak.json: PAN=1',
      'files=1; PAN=1',
    ]);
    expect(status).toBe(2);
  });

  it('prints value-free lines and exits with the scan status', async () => {
    await writeFile(join(directory, '001_leak.json'), JSON.stringify({ message: cardPan }));
    await writeFile(join(directory, '002_broken.json'), `{"pan": "${cardPan}"`);
    await writeFile(join(directory, 'notes.txt'), cardPan);
    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, 'scripts/probes/scanCaptures.mjs'), directory],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe(
      '001_leak.json: PAN=1\n002_broken.json: capture is not valid JSON\nfiles=1; PAN=1\n',
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(2);
  });
});
