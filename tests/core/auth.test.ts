import { describe, expect, it, vi } from 'vitest';

import { TokenManager } from '../../src/core/auth.js';
import {
  PaylovApiError,
  PaylovClientClosedError,
  PaylovConnectionError,
  PaylovProtocolError,
  isPaylovOutcomeUnknown,
} from '../../src/core/errors.js';
import { createHttpClient } from '../../src/core/http.js';
import { ClientLifecycle } from '../../src/core/lifecycle.js';
import type {
  FetchLike,
  HttpClient,
  PaylovLogger,
  PaylovLoggerResponseEvent,
} from '../../src/core/types.js';
import {
  basicAuthHeader,
  captureAsync,
  expectApiError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import {
  createFakeFetch,
  createGate,
  type FakeCall,
  type FakeResponseSpec,
} from '../helpers/fakeFetch.js';
import { loadFixture, loadWire, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/testHttp.js';
import {
  CREATE_RECEIPT,
  GET_STATUS,
  NETWORK_FAILURE,
  PASSWORD,
  SUCCESS,
  SUCCESS_PAYLOAD,
  rawPayload,
} from './httpCases.js';

const RESOURCE_PATH = GET_STATUS.route;
const TOKEN_PATH = '/merchant/oauth2/token/';
const REVOKE_PATH = '/merchant/oauth2/revoke/';

const CONSUMER_KEY = 'EXAMPLE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL';
const CONSUMER_SECRET = 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL';
const USERNAME = 'EXAMPLE-USERNAME-NOT-A-REAL-CREDENTIAL';
const PASSWORD_GRANT = { grant_type: 'password', username: USERNAME, password: PASSWORD };

interface WireToken {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly refresh_expires_in: number;
}

function wireToken(path: string): WireToken {
  return loadWire(path).body as WireToken;
}

const PASSWORD_TOKEN = wireToken('auth/token.passwordSuccess.wire.json');
const REFRESH_TOKEN = wireToken('auth/token.refreshSuccess.wire.json');
const ACCESS_LIFETIME_MS = PASSWORD_TOKEN.expires_in * 1000;

const LOGIN = wireResponse('auth/token.passwordSuccess.wire.json');
const REFRESHED = wireResponse('auth/token.refreshSuccess.wire.json');
const BAD_PASSWORD = wireResponse('auth/token.invalidCredentials.wire.json');
const REFRESH_REJECTED = wireResponse('auth/token.refreshRotated.wire.json');
const RATE_LIMITED = wireResponse('auth/token.rateLimitedRetryAfter.wire.json');
const EXPIRED = wireResponse('envelope/bearer.expired.wire.json');
const RATE_LIMITED_GRANT: FakeResponseSpec = {
  status: 429,
  body: { result: null, error: { code: 'invalid_grant', message: 'invalid_grant' } },
};
const REVOKED = wireResponse('auth/revoke.success.wire.json');
const UNAVAILABLE_GRANT: FakeResponseSpec = {
  status: 503,
  body: { result: null, error: { code: 'invalid_grant', message: 'invalid_grant' } },
};

interface Harness {
  readonly manager: TokenManager;
  readonly http: HttpClient;
  readonly lifecycle: ClientLifecycle;
  readonly fetchImpl: ReturnType<typeof createFakeFetch>;
  /** Mutable clock in epoch ms; every expiry and cool-down decision reads it. */
  readonly clock: { value: number };
}

/** Wired like `PaylovClient`: the token transport has neither auth nor the lifecycle. */
function setup(script: FakeResponseSpec[], logger: PaylovLogger = {}): Harness {
  const clock = { value: 1_700_000_000_000 };
  const fetchImpl = createFakeFetch(script);
  const lifecycle = new ClientLifecycle();
  const transport = {
    origin: BASE_URL,
    fetch: fetchImpl,
    logger,
    sleep: () => Promise.resolve(),
    random: () => 1,
  };
  const manager = new TokenManager({
    http: createHttpClient(transport),
    lifecycle,
    consumerKey: CONSUMER_KEY,
    consumerSecret: CONSUMER_SECRET,
    username: USERNAME,
    password: PASSWORD,
    now: () => clock.value,
  });
  const http = createHttpClient({ ...transport, auth: manager, lifecycle });
  return { manager, http, lifecycle, fetchImpl, clock };
}

function pathsOf(calls: readonly FakeCall[]): string[] {
  return calls.map((call) => new URL(call.url).pathname);
}

function grantTypeOf(call: FakeCall | undefined): unknown {
  return recordOf(call?.body)['grant_type'];
}

async function header(manager: TokenManager): Promise<string> {
  return (await manager.authorize()).header;
}

function expectNoSecrets(error: unknown): void {
  expectNoSecretLeak(error, [
    PASSWORD,
    CONSUMER_SECRET,
    PASSWORD_TOKEN.access_token,
    PASSWORD_TOKEN.refresh_token,
    REFRESH_TOKEN.access_token,
    REFRESH_TOKEN.refresh_token,
  ]);
}

describe('password grant', () => {
  it('logs in lazily with the documented request', async () => {
    const { manager, fetchImpl } = setup([LOGIN]);
    expect(fetchImpl.calls).toHaveLength(0);
    await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
    const call = fetchImpl.calls[0];
    expect(call?.method).toBe('POST');
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH]);
    expect(call?.headers['authorization']).toBe(basicAuthHeader(CONSUMER_KEY, CONSUMER_SECRET));
    expect(call?.headers['content-type']).toBe('application/json');
    expect(recordOf(call?.body)).toEqual(PASSWORD_GRANT);
  });

  it('reuses a live token without further I/O', async () => {
    const { manager, fetchImpl } = setup([LOGIN]);
    const first = await manager.authorize();
    await expect(manager.authorize()).resolves.toEqual(first);
    expect(fetchImpl.calls).toHaveLength(1);
  });
});

describe('refresh margin (60 s)', () => {
  it('does not refresh with 61 s of lifetime left', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS - 61_000;
    await header(manager);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('refreshes with 59 s of lifetime left and adopts the new pair', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN, REFRESHED]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS - 59_000;
    await expect(header(manager)).resolves.toBe(`Bearer ${REFRESH_TOKEN.access_token}`);
    expect(recordOf(fetchImpl.calls[1]?.body)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: PASSWORD_TOKEN.refresh_token,
    });
  });

  it('uses the rotated refresh token for the next grant', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN, REFRESHED, REFRESHED]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    await header(manager);
    expect(recordOf(fetchImpl.calls[2]?.body)['refresh_token']).toBe(REFRESH_TOKEN.refresh_token);
  });

  it('adopts lifetimes longer than today’s instead of rejecting the login', async () => {
    const { manager, fetchImpl, clock } = setup([
      { body: { ...PASSWORD_TOKEN, expires_in: 86_400 } },
    ]);
    await header(manager);
    clock.value += 23 * 60 * 60 * 1000;
    await header(manager);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('skips the refresh grant once the refresh token has expired', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN, LOGIN]);
    await header(manager);
    clock.value += PASSWORD_TOKEN.refresh_expires_in * 1000 + 1;
    await header(manager);
    expect(grantTypeOf(fetchImpl.calls[1])).toBe('password');
  });
});

describe('single flight', () => {
  it('collapses 10 parallel callers into one token request', async () => {
    const gate = createGate();
    const { manager, fetchImpl } = setup([{ ...LOGIN, gate }]);
    const pending = Promise.all(Array.from({ length: 10 }, () => header(manager)));
    await gate.started;
    gate.release();
    const headers = await pending;
    expect(fetchImpl.calls).toHaveLength(1);
    expect(new Set(headers)).toEqual(new Set([`Bearer ${PASSWORD_TOKEN.access_token}`]));
  });

  it('rejects all parallel callers with the same error from one request', async () => {
    const gate = createGate();
    const { manager, fetchImpl } = setup([{ ...BAD_PASSWORD, gate }]);
    const pending = Promise.allSettled(Array.from({ length: 10 }, () => header(manager)));
    await gate.started;
    gate.release();
    const results = await pending;
    const reasons = new Set(
      results.map((result) => (result.status === 'rejected' ? (result.reason as unknown) : result)),
    );
    expect(reasons.size).toBe(1);
    const [reason] = reasons;
    expect(reason).toBeInstanceOf(PaylovApiError);
    expect(fetchImpl.calls).toHaveLength(1);
    expectNoSecrets(reason);
  });

  it('recovers after a connection failure instead of caching it', async () => {
    const { manager, fetchImpl } = setup([NETWORK_FAILURE, LOGIN]);
    await expect(header(manager)).rejects.toBeInstanceOf(PaylovConnectionError);
    await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('collapses callers into one grant after a valid invalidation', async () => {
    const gate = createGate();
    const { manager, fetchImpl } = setup([LOGIN, { ...REFRESHED, gate }]);
    const first = await manager.authorize();
    manager.invalidate(first.generation);
    const pending = Promise.all(Array.from({ length: 10 }, () => manager.authorize()));
    await gate.started;
    gate.release();
    const contexts = await pending;
    expect(fetchImpl.calls).toHaveLength(2);
    expect(new Set(contexts.map(({ generation }) => generation))).toEqual(
      new Set([first.generation + 1]),
    );
  });

  it('ignores a stale invalidation', async () => {
    const { manager, fetchImpl } = setup([LOGIN, REFRESHED]);
    const first = await manager.authorize();
    manager.invalidate(first.generation);
    const current = await manager.authorize();
    manager.invalidate(first.generation);
    await expect(manager.authorize()).resolves.toEqual(current);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('ignores an invalidation before any login', async () => {
    const { manager, fetchImpl } = setup([LOGIN]);
    manager.invalidate(0);
    await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
    expect(fetchImpl.calls.map(grantTypeOf)).toEqual(['password']);
  });
});

describe('refresh to password fallback', () => {
  it('falls back to one password grant when the refresh token is rejected', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN, REFRESH_REJECTED, LOGIN]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
    expect(grantTypeOf(fetchImpl.calls[1])).toBe('refresh_token');
    expect(recordOf(fetchImpl.calls[2]?.body)).toEqual(PASSWORD_GRANT);
  });

  it.each([
    [
      'invalid_client',
      { status: 401, body: loadFixture('auth/token.invalidClient.docs.json') },
      PaylovApiError,
    ],
    ['a 429', RATE_LIMITED, PaylovApiError],
    ['a connection failure', NETWORK_FAILURE, PaylovConnectionError],
    ['a bare 401', { status: 401, rawBody: 'Unauthorized' }, PaylovProtocolError],
    ['a malformed success', { body: { token_type: 'Bearer' } }, PaylovProtocolError],
    ['invalid_grant at HTTP 503', UNAVAILABLE_GRANT, PaylovApiError],
  ] as const)('never sends the password after %s', async (_label, failure, kind) => {
    const { manager, fetchImpl, clock } = setup([LOGIN, failure, LOGIN]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    const error = await captureAsync(header(manager));
    expect(error).toBeInstanceOf(kind);
    expect(fetchImpl.calls).toHaveLength(2);
    expectNoSecrets(error);
  });

  it('latches when both grants are rejected, then stops calling the gateway', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN, REFRESH_REJECTED, BAD_PASSWORD]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    const error = await expectApiError(header(manager), {
      code: 'invalid_grant',
      httpStatus: 401,
    });
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it('does not start the password grant after close during the refresh', async () => {
    const gate = createGate();
    const { manager, fetchImpl, clock, lifecycle } = setup([
      LOGIN,
      { ...REFRESH_REJECTED, gate },
      LOGIN,
    ]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    const pending = captureAsync(header(manager));
    await gate.started;
    lifecycle.close();
    gate.release();
    await expect(pending).resolves.toMatchObject({ code: 'sdk_client_closed' });
    expect(fetchImpl.calls).toHaveLength(2);
  });
});

describe('password latch', () => {
  it('sends a rejected password only once', async () => {
    // Repeated failed password attempts lock the merchant account.
    const { manager, fetchImpl } = setup([BAD_PASSWORD, LOGIN]);
    const error = await expectApiError(header(manager), {
      code: 'invalid_grant',
      httpStatus: 401,
    });
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl.calls).toHaveLength(1);
    expectNoSecrets(error);
  });

  it('hands each caller its own copy of the rejection, concurrent waiters and later calls alike', async () => {
    const gate = createGate();
    const { http, fetchImpl } = setup([{ ...BAD_PASSWORD, gate }]);
    const waiters = [1, 2].map(() => captureAsync(http.request(CREATE_RECEIPT, {}, rawPayload)));
    await gate.started;
    gate.release();
    const errors = [
      ...(await Promise.all(waiters)),
      await captureAsync(http.request(CREATE_RECEIPT, {}, rawPayload)),
    ];
    expect(new Set(errors).size).toBe(3);
    const diagnostics = errors.map((error) => {
      if (!(error instanceof PaylovApiError))
        throw new Error(`expected a PaylovApiError: ${String(error)}`);
      return error.toJSON();
    });
    expect(diagnostics[0]).toMatchObject({
      code: 'invalid_grant',
      endpoint: `POST ${TOKEN_PATH}`,
      isOutcomeUnknown: false,
    });
    expect(diagnostics.slice(1)).toEqual([diagnostics[0], diagnostics[0]]);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('latches an unknown consumer key and tells it apart from a bad password', async () => {
    const { manager, fetchImpl } = setup([
      wireResponse('auth/token.invalidConsumerKey.wire.json'),
      LOGIN,
    ]);
    const error = await expectApiError(header(manager), {
      code: 'invalid_grant',
      httpStatus: 401,
    });
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it.each([
    ['a bare 401', { status: 401, rawBody: 'Unauthorized' }, 'sdk_unexpected_status'],
    ['a bare 403', { status: 403, rawBody: '<html>Forbidden</html>' }, 'sdk_unexpected_status'],
    ['invalid_request', wireResponse('auth/token.basicMissing.wire.json'), 'invalid_request'],
    ['a server error', wireResponse('envelope/serverError.wire.json'), 'server_error'],
    ['invalid_grant at HTTP 503', UNAVAILABLE_GRANT, 'invalid_grant'],
  ] as const)('does not latch on %s', async (_label, failure, code) => {
    const { manager, fetchImpl } = setup([failure, LOGIN]);
    await expect(header(manager)).rejects.toMatchObject({ code });
    await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
    expect(fetchImpl.calls).toHaveLength(2);
  });
});

describe('rate-limit cool-down', () => {
  it('rethrows the 429 without I/O until retryAfterSeconds has passed', async () => {
    const { manager, fetchImpl, clock } = setup([RATE_LIMITED, LOGIN]);
    const error = await expectApiError(header(manager), {
      code: 'rate_limit_exceeded',
      httpStatus: 429,
    });
    expect(error.retryAfterSeconds).toBe(48);
    clock.value += 47_999;
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl.calls).toHaveLength(1);
    clock.value += 1;
    await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it.each([
    [
      'an enveloped 429 whose delay is only in its message',
      wireResponse('auth/token.rateLimited.wire.json'),
      'rate_limit_exceeded',
    ],
    [
      'a proxy 429 without an envelope',
      { status: 429, rawBody: 'Too Many Requests' },
      'sdk_unexpected_status',
    ],
  ] as const)('cools down for 60 s after %s', async (_label, tooMany, code) => {
    const { manager, fetchImpl, clock } = setup([tooMany, LOGIN]);
    const error = await captureAsync(header(manager));
    expect(error).toMatchObject({ code, httpStatus: 429 });
    clock.value += 59_999;
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl.calls).toHaveLength(1);
    clock.value += 1;
    await header(manager);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it.each([
    ['its Retry-After header over the body delay', { 'retry-after': '48' }, 48],
    ['the body delay without a Retry-After header', {}, 2],
  ] as const)(
    'cools down a 429 carrying a card block for %s',
    async (_label, headers, retryAfterSeconds) => {
      const blocked: FakeResponseSpec = {
        status: 429,
        headers,
        body: {
          result: null,
          error: { code: 'card_is_blocked', message: 'blocked', data: { sec_to_retry: 2 } },
        },
      };
      const { manager, fetchImpl, clock } = setup([blocked, LOGIN]);
      const error = await expectApiError(header(manager), {
        code: 'card_is_blocked',
        httpStatus: 429,
      });
      expect(error.retryAfterSeconds).toBe(retryAfterSeconds);
      clock.value += retryAfterSeconds * 1000 - 1;
      await expect(header(manager)).rejects.toBe(error);
      expect(fetchImpl.calls).toHaveLength(1);
      clock.value += 1;
      await header(manager);
      expect(fetchImpl.calls).toHaveLength(2);
    },
  );

  it('cools down for the Retry-After of a 429 with a plain-text body', async () => {
    const { manager, fetchImpl, clock } = setup([
      { status: 429, rawBody: 'Too Many Requests', headers: { 'retry-after': '180' } },
      LOGIN,
    ]);
    const error = await captureAsync(header(manager));
    expect(error).toBeInstanceOf(PaylovProtocolError);
    expect(error).toMatchObject({
      code: 'sdk_unexpected_status',
      httpStatus: 429,
      retryAfterSeconds: 180,
    });
    clock.value += 179_999;
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl.calls).toHaveLength(1);
    clock.value += 1;
    await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it.each([
    ['no Retry-After', {}, undefined, 60_000],
    ['a Retry-After of 180', { 'retry-after': '180' }, 180, 180_000],
  ] as const)(
    'cools down after a 429 whose body read fails, with %s',
    async (_label, headers, retryAfterSeconds, coolDownMs) => {
      const clock = { value: 1_700_000_000_000 };
      const failedRead = new ReadableStream({
        pull: (controller) => {
          controller.error(new TypeError('terminated'));
        },
      });
      const fetchImpl = vi
        .fn<FetchLike>(() => Promise.resolve(new Response(JSON.stringify(PASSWORD_TOKEN))))
        .mockResolvedValueOnce(new Response(failedRead, { status: 429, headers }));
      const manager = new TokenManager({
        http: createHttpClient({ origin: BASE_URL, fetch: fetchImpl }),
        lifecycle: new ClientLifecycle(),
        consumerKey: CONSUMER_KEY,
        consumerSecret: CONSUMER_SECRET,
        username: USERNAME,
        password: PASSWORD,
        now: () => clock.value,
      });
      const error = await captureAsync(header(manager));
      expect(error).toBeInstanceOf(PaylovProtocolError);
      expect(error).toMatchObject({ code: 'sdk_unexpected_status', httpStatus: 429 });
      expect(recordOf(error)['retryAfterSeconds']).toBe(retryAfterSeconds);
      clock.value += coolDownMs - 1;
      await expect(header(manager)).rejects.toBe(error);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      clock.value += 1;
      await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it('starts on a rate-limited refresh without sending the password', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN, RATE_LIMITED, REFRESHED]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    await expectApiError(header(manager), { code: 'rate_limit_exceeded', httpStatus: 429 });
    await expectApiError(header(manager), { code: 'rate_limit_exceeded', httpStatus: 429 });
    expect(fetchImpl.calls).toHaveLength(2);
    clock.value += 48_000;
    await expect(header(manager)).resolves.toBe(`Bearer ${REFRESH_TOKEN.access_token}`);
  });
});

describe('a rate-limited invalid_grant', () => {
  it('cools down a refresh instead of falling back to the password', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN, RATE_LIMITED_GRANT, REFRESHED]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    const error = await expectApiError(header(manager), {
      code: 'invalid_grant',
      httpStatus: 429,
    });
    clock.value += 59_999;
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl.calls).toHaveLength(2);
    clock.value += 1;
    await expect(header(manager)).resolves.toBe(`Bearer ${REFRESH_TOKEN.access_token}`);
    expect(fetchImpl.calls.map(grantTypeOf)).toEqual([
      'password',
      'refresh_token',
      'refresh_token',
    ]);
  });

  it('cools down a password grant instead of latching it', async () => {
    const { manager, fetchImpl, clock } = setup([RATE_LIMITED_GRANT, LOGIN]);
    const error = await expectApiError(header(manager), {
      code: 'invalid_grant',
      httpStatus: 429,
    });
    clock.value += 59_999;
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl.calls).toHaveLength(1);
    clock.value += 1;
    await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
    expect(fetchImpl.calls.map(grantTypeOf)).toEqual(['password', 'password']);
  });
});

describe('401 replay end to end', () => {
  it('refreshes and replays the request once', async () => {
    const { manager, http, fetchImpl } = setup([LOGIN, EXPIRED, REFRESHED, SUCCESS]);
    await expect(http.request(GET_STATUS, {}, rawPayload)).resolves.toEqual(SUCCESS_PAYLOAD);
    expect(pathsOf(fetchImpl.calls)).toEqual([
      TOKEN_PATH,
      RESOURCE_PATH,
      TOKEN_PATH,
      RESOURCE_PATH,
    ]);
    expect(grantTypeOf(fetchImpl.calls[2])).toBe('refresh_token');
    expect(fetchImpl.calls[1]?.headers['authorization']).toBe(
      `Bearer ${PASSWORD_TOKEN.access_token}`,
    );
    expect(fetchImpl.calls[3]?.headers['authorization']).toBe(
      `Bearer ${REFRESH_TOKEN.access_token}`,
    );
    await expect(header(manager)).resolves.toBe(`Bearer ${REFRESH_TOKEN.access_token}`);
  });

  it('surfaces the second rejection instead of looping', async () => {
    const { http, fetchImpl } = setup([LOGIN, EXPIRED, REFRESHED, EXPIRED]);
    const error = await expectApiError(http.request(CREATE_RECEIPT, {}, rawPayload), {
      code: 'permission_denied',
      httpStatus: 401,
    });
    expect(fetchImpl.calls).toHaveLength(4);
    expectNoSecrets(error);
  });

  it('a bare 401 neither replays nor invalidates the token', async () => {
    const { http, fetchImpl } = setup([LOGIN, { status: 401, rawBody: '' }, SUCCESS]);
    await expect(http.request(GET_STATUS, {}, rawPayload)).rejects.toMatchObject({
      code: 'sdk_unexpected_status',
    });
    await expect(http.request(GET_STATUS, {}, rawPayload)).resolves.toEqual(SUCCESS_PAYLOAD);
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, RESOURCE_PATH, RESOURCE_PATH]);
  });

  it('ignores an out-of-order stale 401 instead of invalidating the newer token', async () => {
    const [early, late] = [createGate(), createGate()];
    const { http, fetchImpl } = setup([
      LOGIN,
      { ...EXPIRED, gate: early },
      { ...EXPIRED, gate: late },
      REFRESHED,
      SUCCESS,
      SUCCESS,
    ]);
    const first = http.request(GET_STATUS, {}, rawPayload);
    const second = http.request(GET_STATUS, {}, rawPayload);
    // Both requests hold the first token before either 401 arrives.
    await Promise.all([early.started, late.started]);
    early.release();
    await expect(first).resolves.toEqual(SUCCESS_PAYLOAD);
    late.release();
    await expect(second).resolves.toEqual(SUCCESS_PAYLOAD);
    expect(pathsOf(fetchImpl.calls)).toEqual([
      TOKEN_PATH,
      RESOURCE_PATH,
      RESOURCE_PATH,
      TOKEN_PATH,
      RESOURCE_PATH,
      RESOURCE_PATH,
    ]);
  });
});

describe('waiter cancellation', () => {
  it('an aborted waiter leaves the shared grant to the others', async () => {
    const gate = createGate();
    const { http, fetchImpl } = setup([{ ...LOGIN, gate }, SUCCESS]);
    const controller = new AbortController();
    const aborted = captureAsync(
      http.request(GET_STATUS, { signal: controller.signal }, rawPayload),
    );
    const other = http.request(GET_STATUS, {}, rawPayload);
    await gate.started;
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ code: 'sdk_aborted' });
    gate.release();
    await expect(other).resolves.toEqual(SUCCESS_PAYLOAD);
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, RESOURCE_PATH]);
    expect(fetchImpl.calls[0]?.signal?.aborted).toBe(false);
  });
});

describe('close', () => {
  it('revokes the access token without Authorization and refuses later calls', async () => {
    const { manager, http, fetchImpl } = setup([LOGIN, REVOKED]);
    await header(manager);
    await manager.close();
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, REVOKE_PATH]);
    expect(recordOf(fetchImpl.calls[1]?.body)).toEqual({ token: PASSWORD_TOKEN.access_token });
    expect(fetchImpl.calls[1]?.headers['authorization']).toBeUndefined();
    await expect(manager.authorize()).rejects.toMatchObject({ code: 'sdk_client_closed' });
    await expect(http.request(GET_STATUS, {}, rawPayload)).rejects.toMatchObject({
      code: 'sdk_client_closed',
    });
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('does no I/O when no token was ever issued', async () => {
    const { manager, fetchImpl } = setup([]);
    await manager.close();
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('shares one revocation between concurrent and repeated calls', async () => {
    const gate = createGate();
    const { manager, fetchImpl } = setup([LOGIN, { ...REVOKED, gate }]);
    await header(manager);
    const first = manager.close();
    await gate.started;
    const second = manager.close();
    gate.release();
    await Promise.all([first, second, manager.close()]);
    await manager.close();
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, REVOKE_PATH]);
  });

  it('logs the recorded acknowledgement as a successful revocation', async () => {
    const events: PaylovLoggerResponseEvent[] = [];
    const { manager } = setup([LOGIN, REVOKED], {
      onResponse: (event) => void events.push(event),
    });
    await header(manager);
    await manager.close();
    const revocations = events.filter((event) => event.endpoint === `POST ${REVOKE_PATH}`);
    expect(revocations).toHaveLength(1);
    expect(revocations[0]).not.toHaveProperty('errorCode');
  });

  it('treats an already revoked token as done', async () => {
    const { manager } = setup([LOGIN, wireResponse('auth/revoke.invalidToken.wire.json')]);
    await header(manager);
    await expect(manager.close()).resolves.toBeUndefined();
  });

  it.each([
    [
      'a validation error',
      wireResponse('auth/revoke.validation.wire.json'),
      400,
      'validation_error',
    ],
    ['a connection failure', NETWORK_FAILURE, 0, 'sdk_network_error'],
    ['a 200 with an HTML body', { rawBody: '<html>OK</html>' }, 200, 'sdk_malformed_response'],
    ['a 200 with an empty JSON object', { body: {} }, 200, 'sdk_malformed_response'],
    ['a 200 with another status', { body: { status: 'pending' } }, 200, 'sdk_malformed_response'],
  ] as const)(
    'resolves after %s and leaves it to the logger',
    async (_label, failure, httpStatus, errorCode) => {
      const events: PaylovLoggerResponseEvent[] = [];
      const { manager, fetchImpl } = setup([LOGIN, failure], {
        onResponse: (event) => void events.push(event),
      });
      await header(manager);
      await expect(manager.close()).resolves.toBeUndefined();
      const revocations = events.filter((event) => event.endpoint === `POST ${REVOKE_PATH}`);
      expect(revocations).toEqual([expect.objectContaining({ httpStatus, errorCode })]);
      expectNoSecrets(events);
      await expect(manager.authorize()).rejects.toMatchObject({ code: 'sdk_client_closed' });
      expect(fetchImpl.calls).toHaveLength(2);
    },
  );

  it('waits for an in-flight grant, fails its waiters and revokes the newest token', async () => {
    const gate = createGate();
    const { manager, fetchImpl } = setup([{ ...LOGIN, gate }, REVOKED]);
    const waiter = captureAsync(manager.authorize());
    await gate.started;
    const closing = manager.close();
    gate.release();
    await closing;
    await expect(waiter).resolves.toMatchObject({ code: 'sdk_client_closed' });
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, REVOKE_PATH]);
    expect(recordOf(fetchImpl.calls[1]?.body)).toEqual({ token: PASSWORD_TOKEN.access_token });
  });

  it('sees a grant whose request hook closed the client and revokes the token it issued', async () => {
    const hooks = { onTokenRequest: (): void => undefined };
    const { manager, fetchImpl } = setup([LOGIN, REVOKED], {
      onRequest: (event) => {
        if (event.endpoint === `POST ${TOKEN_PATH}`) hooks.onTokenRequest();
      },
    });
    let closing: Promise<void> | undefined;
    hooks.onTokenRequest = () => {
      closing = manager.close();
    };
    await expect(manager.authorize()).rejects.toMatchObject({ code: 'sdk_client_closed' });
    await closing;
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, REVOKE_PATH]);
    expect(recordOf(fetchImpl.calls[1]?.body)).toEqual({ token: PASSWORD_TOKEN.access_token });
  });

  it('revokes the prior access token when a refresh in flight at close is rejected', async () => {
    const gate = createGate();
    const { manager, fetchImpl, clock } = setup([LOGIN, { ...REFRESH_REJECTED, gate }, REVOKED]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS - 59_000;
    const waiter = captureAsync(manager.authorize());
    await gate.started;
    const closing = manager.close();
    gate.release();
    await closing;
    await expect(waiter).resolves.toMatchObject({ code: 'sdk_client_closed' });
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, TOKEN_PATH, REVOKE_PATH]);
    expect(recordOf(fetchImpl.calls[2]?.body)).toEqual({ token: PASSWORD_TOKEN.access_token });
  });

  it('revokes the prior access token after both grants are rejected', async () => {
    const { manager, fetchImpl, clock } = setup([LOGIN, REFRESH_REJECTED, BAD_PASSWORD, REVOKED]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS - 59_000;
    await expectApiError(header(manager), { code: 'invalid_grant', httpStatus: 401 });
    await manager.close();
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, TOKEN_PATH, TOKEN_PATH, REVOKE_PATH]);
    expect(recordOf(fetchImpl.calls[3]?.body)).toEqual({ token: PASSWORD_TOKEN.access_token });
  });

  it('still closes when the in-flight grant fails', async () => {
    const gate = createGate();
    const { manager, fetchImpl } = setup([{ ...NETWORK_FAILURE, gate }]);
    const waiter = captureAsync(manager.authorize());
    await gate.started;
    const closing = manager.close();
    gate.release();
    await closing;
    await expect(waiter).resolves.toBeInstanceOf(PaylovConnectionError);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('fails a request in flight that the revocation rejects, without re-sending it', async () => {
    const gate = createGate();
    const { manager, http, fetchImpl } = setup([LOGIN, { ...EXPIRED, gate }, REVOKED]);
    await header(manager);
    const inFlight = captureAsync(http.request(CREATE_RECEIPT, {}, rawPayload));
    await gate.started;
    await manager.close();
    gate.release();
    const error = await inFlight;
    expect(error).toBeInstanceOf(PaylovClientClosedError);
    expect(isPaylovOutcomeUnknown(error)).toBe(false);
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, CREATE_RECEIPT.route, REVOKE_PATH]);
  });

  // sdk_client_closed promises the call had no effect, so a success Paylov already sent stands.
  it('returns a success that arrives after close, without re-sending or aborting it', async () => {
    const gate = createGate();
    const { manager, http, fetchImpl } = setup([LOGIN, { ...SUCCESS, gate }, REVOKED]);
    await header(manager);
    const inFlight = http.request(CREATE_RECEIPT, {}, rawPayload);
    await gate.started;
    await manager.close();
    gate.release();
    await expect(inFlight).resolves.toEqual(SUCCESS_PAYLOAD);
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, CREATE_RECEIPT.route, REVOKE_PATH]);
    expect(fetchImpl.calls[1]?.signal?.aborted).toBe(false);
  });

  it('resolves when a signal abandons the wait, and still revokes', async () => {
    const gate = createGate();
    const { manager, fetchImpl } = setup([LOGIN, { ...REVOKED, gate }]);
    await header(manager);
    const controller = new AbortController();
    const abandoned = manager.close(controller.signal);
    await gate.started;
    controller.abort();
    await expect(abandoned).resolves.toBeUndefined();
    gate.release();
    await expect(manager.authorize()).rejects.toMatchObject({ code: 'sdk_client_closed' });
    await expect(manager.close()).resolves.toBeUndefined();
    expect(fetchImpl.calls).toHaveLength(2);
  });
});

describe('malformed token responses', () => {
  const cases: [string, unknown, string | undefined][] = [
    ['missing access_token', { ...PASSWORD_TOKEN, access_token: undefined }, 'body.access_token'],
    ['empty access_token', { ...PASSWORD_TOKEN, access_token: '' }, 'body.access_token'],
    [
      'missing refresh_token',
      { ...PASSWORD_TOKEN, refresh_token: undefined },
      'body.refresh_token',
    ],
    ['missing token_type', { ...PASSWORD_TOKEN, token_type: undefined }, 'body.token_type'],
    [
      'a token_type other than Bearer',
      { ...PASSWORD_TOKEN, token_type: 'Other' },
      'body.token_type',
    ],
    ['expires_in as a string', { ...PASSWORD_TOKEN, expires_in: '3600' }, 'body.expires_in'],
    ['expires_in of zero', { ...PASSWORD_TOKEN, expires_in: 0 }, 'body.expires_in'],
    ['fractional expires_in', { ...PASSWORD_TOKEN, expires_in: 1.5 }, 'body.expires_in'],
    [
      'negative refresh_expires_in',
      { ...PASSWORD_TOKEN, refresh_expires_in: -1 },
      'body.refresh_expires_in',
    ],
    [
      'expires_in at the safe-integer limit',
      { ...PASSWORD_TOKEN, expires_in: Number.MAX_SAFE_INTEGER },
      'body.expires_in',
    ],
    [
      'refresh_expires_in absent',
      { ...PASSWORD_TOKEN, refresh_expires_in: undefined },
      'body.refresh_expires_in',
    ],
    ['a null body', null, undefined],
    ['an array body', [], undefined],
  ];

  it('reports a 200 empty JSON object grant in its one response event', async () => {
    const events: PaylovLoggerResponseEvent[] = [];
    const { manager } = setup([{ body: {} }], { onResponse: (event) => void events.push(event) });
    await expectMalformed(header(manager), 'body.token_type');
    expect(events).toEqual([
      expect.objectContaining({
        endpoint: `POST ${TOKEN_PATH}`,
        httpStatus: 200,
        errorCode: 'sdk_malformed_response',
      }),
    ]);
  });

  it.each(cases)(
    'rejects %s as sdk_malformed_response at %s without the tokens',
    async (_label, body, path) => {
      const { manager, fetchImpl } = setup([{ body }, LOGIN]);
      const error = await expectMalformed(header(manager), path);
      expect(error.endpoint).toBe(`POST ${TOKEN_PATH}`);
      expectNoSecrets(error);
      await expect(header(manager)).resolves.toBe(`Bearer ${PASSWORD_TOKEN.access_token}`);
      expect(fetchImpl.calls).toHaveLength(2);
    },
  );
});
