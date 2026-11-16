import { describe, expect, it } from 'vitest';

import { PaylovClient, type PaylovClientConfig } from '../src/client.js';
import { expectInputError, expectNoSecretLeak } from './helpers/asserts.js';
import { createFakeFetch } from './helpers/fakeFetch.js';
import { BASE_URL } from './helpers/testHttp.js';

const CONSUMER_SECRET = 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL';
const PASSWORD = 'EXAMPLE-PASSWORD-NOT-A-REAL-CREDENTIAL';

const VALID: PaylovClientConfig = {
  baseUrl: BASE_URL,
  consumerKey: 'EXAMPLE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL',
  consumerSecret: CONSUMER_SECRET,
  username: 'EXAMPLE-USERNAME-NOT-A-REAL-CREDENTIAL',
  password: PASSWORD,
};

const CONFIG = 'sdk_config_error';
const CREDENTIALS = [PASSWORD, CONSUMER_SECRET];

describe('PaylovClient configuration', () => {
  it.each([undefined, null, [], 'config', 42, true])('rejects the config %j', async (config) => {
    await expectInputError(() => new PaylovClient(config as never), {
      code: CONFIG,
      field: undefined,
      rule: 'type',
    });
  });

  it.each(['baseUrl', 'consumerKey', 'consumerSecret', 'username', 'password'] as const)(
    'rejects a missing or blank %s without quoting its value',
    async (field) => {
      for (const [bad, rule] of [
        [undefined, 'required'],
        ['', 'required'],
        ['   ', 'required'],
        [42, 'type'],
        [{}, 'type'],
        [[], 'type'],
      ] as const) {
        const error = await expectInputError(() => new PaylovClient({ ...VALID, [field]: bad }), {
          code: CONFIG,
          field,
          rule,
        });
        expectNoSecretLeak(error, CREDENTIALS);
      }
    },
  );

  it.each([
    ['not an absolute URL', 'api.paylov.uz', 'baseUrl must be an absolute https URL'],
    ['another scheme', 'ftp://api.paylov.uz', 'baseUrl must be an absolute https URL'],
    ['cleartext http', 'http://dev.gw.paylov.uz', 'baseUrl must use https'],
    [
      'a /merchant path',
      `${BASE_URL}/merchant`,
      'baseUrl must be an origin without a path, e.g. https://dev.gw.paylov.uz',
    ],
  ])('rejects a baseUrl with %s', async (_label, baseUrl, message) => {
    const error = await expectInputError(() => new PaylovClient({ ...VALID, baseUrl }), {
      code: CONFIG,
      field: 'baseUrl',
      rule: 'format',
    });
    expect(error.message).toBe(message);
  });

  it('rejects credentials, queries and fragments on baseUrl without quoting them', async () => {
    const secret = 'EXAMPLE-BASE-URL-SECRET';
    for (const baseUrl of [
      `https://merchant:${secret}@api.paylov.test`,
      `https://api.paylov.test/?token=${secret}`,
      `https://api.paylov.test/#${secret}`,
      'https://api.paylov.test?',
    ]) {
      const error = await expectInputError(() => new PaylovClient({ ...VALID, baseUrl }), {
        code: CONFIG,
        field: 'baseUrl',
        rule: 'format',
      });
      expectNoSecretLeak(error, [secret, baseUrl, ...CREDENTIALS]);
    }
  });

  it('accepts a padded origin, a trailing slash and an explicit port', () => {
    for (const baseUrl of [`  ${BASE_URL}  `, `${BASE_URL}/`, 'https://api.paylov.test:8443']) {
      expect(new PaylovClient({ ...VALID, baseUrl })).toBeInstanceOf(PaylovClient);
    }
  });

  it('rejects a non-positive, fractional or oversized timeoutMs', async () => {
    for (const [timeoutMs, rule] of [
      [0, 'range'],
      [-1, 'range'],
      [1.5, 'type'],
      [2_147_483_648, 'range'],
      [Number.MAX_SAFE_INTEGER, 'range'],
    ] as const) {
      await expectInputError(() => new PaylovClient({ ...VALID, timeoutMs }), {
        code: CONFIG,
        field: 'timeoutMs',
        rule,
      });
    }
  });

  it('validates the fetch and logger shapes', async () => {
    for (const [key, value, field] of [
      ['fetch', {}, 'fetch'],
      ['fetch', 'fetch', 'fetch'],
      ['logger', [], 'logger'],
      ['logger', 'logger', 'logger'],
      ['logger', { onRequest: true }, 'logger.onRequest'],
      ['logger', { onResponse: true }, 'logger.onResponse'],
    ] as const) {
      const error = await expectInputError(() => new PaylovClient({ ...VALID, [key]: value }), {
        code: CONFIG,
        field,
        rule: 'type',
      });
      expect(error.message).toContain(field);
    }
  });

  it('does no I/O on construction', () => {
    const fetchImpl = createFakeFetch([]);
    void new PaylovClient({ ...VALID, fetch: fetchImpl });
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('PaylovClient.close', () => {
  it('needs no I/O before any token was issued, and can be repeated', async () => {
    const fetchImpl = createFakeFetch([]);
    const client = new PaylovClient({ ...VALID, fetch: fetchImpl });
    await client.close();
    await client.close({});
    await client.close({ signal: AbortSignal.timeout(1_000) });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('rejects options that carry anything but an AbortSignal', async () => {
    const client = new PaylovClient(VALID);
    await expectInputError(client.close({ signal: 'soon' as never }), {
      field: 'signal',
      rule: 'type',
    });
  });
});
