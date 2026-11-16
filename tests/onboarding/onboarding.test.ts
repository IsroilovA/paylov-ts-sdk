import { describe, expect, it } from 'vitest';

import { PaylovOnboarding } from '../../src/onboarding/client.js';
import type { CompleteOnboardingParams } from '../../src/onboarding/types.js';
import {
  captureAsync,
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
} from '../helpers/asserts.js';
import { createFakeFetch, type FakeResponseSpec } from '../helpers/fakeFetch.js';
import { fixtureResponse, loadFixture, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL, recordingLogger } from '../helpers/testHttp.js';

const TOKEN = 'EXAMPLE-ONBOARDING-TOKEN-NOT-A-REAL-TOKEN';
const USERNAME = 'EXAMPLE-USERNAME-NOT-A-REAL-CREDENTIAL';
const PASSWORD = 'EXAMPLE-PASSWORD-NOT-A-REAL-CREDENTIAL';
const ONBOARDING_URL = `${BASE_URL}/merchant/onboarding/?token=${TOKEN}`;

const TOKEN_OK: FakeResponseSpec = fixtureResponse('onboarding/checkToken.ok.docs.json');
const TOKEN_USED = wireResponse('onboarding/checkToken.invalidOrExpired.wire.json');
const CREDENTIALS_BODY = loadFixture<Record<string, string>>(
  'onboarding/complete.success.docs.json',
);
const ISSUED_SECRET = CREDENTIALS_BODY['consumer_secret'] ?? '';
const SECRETS = [TOKEN, PASSWORD, ISSUED_SECRET];

const COMPLETE: CompleteOnboardingParams = {
  token: TOKEN,
  username: USERNAME,
  password: PASSWORD,
};

function setup(script: FakeResponseSpec[]) {
  const fetchImpl = createFakeFetch(script);
  const { logger, requests, responses } = recordingLogger();
  const onboarding = new PaylovOnboarding({ baseUrl: BASE_URL, fetch: fetchImpl, logger });
  return { onboarding, fetchImpl, events: { requests, responses } };
}

const MALFORMED_VALUES = [
  [undefined, 'required'],
  [42, 'type'],
  ['', 'required'],
  ['        ', 'required'],
] as const;

describe('PaylovOnboarding.checkToken', () => {
  it('sends the token as a query parameter without Authorization and resolves true', async () => {
    const { onboarding, fetchImpl } = setup([TOKEN_OK]);
    await expect(onboarding.checkToken({ token: TOKEN })).resolves.toBe(true);
    expect(fetchImpl.calls).toMatchObject([
      { url: ONBOARDING_URL, method: 'GET', body: undefined },
    ]);
    expect(fetchImpl.calls[0]?.headers).not.toHaveProperty('authorization');
  });

  it('resolves false for a consumed or expired token', async () => {
    const { onboarding } = setup([TOKEN_USED]);
    await expect(onboarding.checkToken({ token: TOKEN })).resolves.toBe(false);
  });

  it('throws every other gateway error instead of answering false', async () => {
    const { onboarding } = setup([wireResponse('onboarding/checkToken.tooShort.wire.json')]);
    const error = await expectApiError(onboarding.checkToken({ token: TOKEN }), {
      code: 'validation_error',
      fields: ['token'],
    });
    expectNoSecretLeak(error, SECRETS);
  });

  it('rejects any other success body', async () => {
    const { onboarding } = setup([{ body: { status: 'error' } }]);
    await expectMalformed(onboarding.checkToken({ token: TOKEN }), 'body.status');
  });

  it('requires a non-blank token before any I/O', async () => {
    const { onboarding, fetchImpl } = setup([]);
    for (const [token, rule] of MALFORMED_VALUES) {
      const error = await expectInputError(onboarding.checkToken({ token } as never), {
        field: 'token',
        rule,
      });
      expectNoSecretLeak(error, SECRETS);
    }
    await expectInputError(onboarding.checkToken(undefined as never), {
      field: undefined,
      rule: 'type',
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('keeps the token out of logger events', async () => {
    const { onboarding, events } = setup([TOKEN_USED]);
    await onboarding.checkToken({ token: TOKEN });
    expect(events.requests).toStrictEqual([
      { method: 'GET', endpoint: 'GET /merchant/onboarding/', attempt: 1 },
    ]);
    expect(events.responses).toMatchObject([{ httpStatus: 400, errorCode: 'invalid_or_expired' }]);
    expectNoSecretLeak(events, SECRETS);
  });
});

describe('PaylovOnboarding.complete', () => {
  it('posts the username and password and decodes the issued credentials', async () => {
    const { onboarding, fetchImpl } = setup([{ body: CREDENTIALS_BODY }]);
    await expect(onboarding.complete(COMPLETE)).resolves.toStrictEqual({
      consumerKey: 'app_EXAMPLE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL',
      consumerSecret: ISSUED_SECRET,
      username: USERNAME,
    });
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]).toMatchObject({
      url: ONBOARDING_URL,
      method: 'POST',
      body: { username: USERNAME, password: PASSWORD },
    });
    expect(Object.keys(fetchImpl.calls[0]?.body as object)).toEqual(['username', 'password']);
    expect(fetchImpl.calls[0]?.headers['content-type']).toBe('application/json');
    expect(fetchImpl.calls[0]?.headers).not.toHaveProperty('authorization');
  });

  it('sends short values unchanged and reports gateway validation by field name only', async () => {
    const { onboarding, fetchImpl } = setup([
      wireResponse('onboarding/complete.validation.wire.json'),
    ]);
    const short = { ...COMPLETE, username: 'short', password: 'Ab1!xyz' };
    const error = await expectApiError(onboarding.complete(short), {
      code: 'validation_error',
      fields: ['token', 'username', 'password'],
    });
    expect(fetchImpl.calls[0]?.body).toEqual({ username: 'short', password: 'Ab1!xyz' });
    expect(error.endpoint).toBe('POST /merchant/onboarding/');
    expectNoSecretLeak(error, SECRETS);
  });

  it('surfaces a used token as invalid_or_expired', async () => {
    const { onboarding } = setup([TOKEN_USED]);
    await expectApiError(onboarding.complete(COMPLETE), { code: 'invalid_or_expired' });
  });

  it('rejects a malformed success without quoting the issued secret', async () => {
    for (const [body, path] of [
      [{ ...CREDENTIALS_BODY, consumer_secret: undefined }, 'body.consumer_secret'],
      [{ ...CREDENTIALS_BODY, consumer_key: 7 }, 'body.consumer_key'],
      [{ ...CREDENTIALS_BODY, username: null }, 'body.username'],
      [{ result: CREDENTIALS_BODY, error: null }, 'body.consumer_key'],
    ] as const) {
      const { onboarding, events } = setup([{ body }]);
      const error = await expectMalformed(onboarding.complete(COMPLETE), path);
      expectNoSecretLeak(error, SECRETS);
      expectNoSecretLeak(events, SECRETS);
    }
  });

  it.each(['token', 'username', 'password'] as const)(
    'requires a non-blank %s before any I/O',
    async (field) => {
      const { onboarding, fetchImpl } = setup([]);
      for (const [value, rule] of MALFORMED_VALUES) {
        const error = await expectInputError(onboarding.complete({ ...COMPLETE, [field]: value }), {
          field,
          rule,
        });
        expectNoSecretLeak(error, SECRETS);
      }
      expect(fetchImpl.calls).toHaveLength(0);
    },
  );

  it('keeps the token, password and issued secret out of logger events', async () => {
    const { onboarding, events } = setup([{ body: CREDENTIALS_BODY }]);
    await onboarding.complete(COMPLETE);
    expect(events.requests).toStrictEqual([
      { method: 'POST', endpoint: 'POST /merchant/onboarding/', attempt: 1 },
    ]);
    expect(events.responses).toHaveLength(1);
    expectNoSecretLeak(events, SECRETS);
  });
});

describe('call options', () => {
  it('rejects a signal that is not an AbortSignal before any I/O', async () => {
    const { onboarding, fetchImpl } = setup([]);
    for (const call of [
      () => onboarding.checkToken({ token: TOKEN }, { signal: 'soon' as never }),
      () => onboarding.complete(COMPLETE, { signal: 'soon' as never }),
    ]) {
      await expectInputError(call(), { field: 'signal', rule: 'type' });
    }
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('ends an aborted call with sdk_aborted', async () => {
    const { onboarding } = setup([{ ...TOKEN_OK, delayMs: 1_000 }]);
    const error = await captureAsync(
      onboarding.checkToken({ token: TOKEN }, { signal: AbortSignal.timeout(5) }),
    );
    expect(error).toMatchObject({ code: 'sdk_aborted', endpoint: 'GET /merchant/onboarding/' });
    expectNoSecretLeak(error, SECRETS);
  });
});

describe('PaylovOnboarding configuration', () => {
  it.each([
    [{ baseUrl: 'http://dev.gw.paylov.uz' }, 'baseUrl', 'format'],
    [{ baseUrl: 'https://dev.gw.paylov.uz/merchant' }, 'baseUrl', 'format'],
    [{ baseUrl: BASE_URL, fetch: 'fetch' }, 'fetch', 'type'],
  ] as const)('requires an https origin and a fetch function: %j', async (config, field, rule) => {
    await expectInputError(() => new PaylovOnboarding(config as never), {
      code: 'sdk_config_error',
      field,
      rule,
    });
  });
});
