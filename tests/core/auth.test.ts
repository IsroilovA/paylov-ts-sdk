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
import { createFakeFetch, type FakeCall, type FakeResponseSpec } from '../helpers/fakeFetch.js';
import { loadFixture, loadWire, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/testHttp.js';
import {
  CREATE_RECEIPT,
  GET_STATUS,
  NETWORK_FAILURE,
  PASSWORD,
  SUCCESS,
  SUCCESS_PAYLOAD,
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
const REVOKED = wireResponse('auth/revoke.success.wire.json');

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
    const { manager, fetchImpl } = setup([{ ...LOGIN, delayMs: 20 }]);
    const headers = await Promise.all(Array.from({ length: 10 }, () => header(manager)));
    expect(fetchImpl.calls).toHaveLength(1);
    expect(new Set(headers)).toEqual(new Set([`Bearer ${PASSWORD_TOKEN.access_token}`]));
  });

  it('rejects all parallel callers with the same error from one request', async () => {
    const { manager, fetchImpl } = setup([{ ...BAD_PASSWORD, delayMs: 10 }]);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => header(manager)));
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
    const { manager, fetchImpl } = setup([LOGIN, { ...REFRESHED, delayMs: 20 }]);
    const first = await manager.authorize();
    manager.invalidate(first.generation);
    const contexts = await Promise.all(Array.from({ length: 10 }, () => manager.authorize()));
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
    const { manager, fetchImpl, clock, lifecycle } = setup([
      LOGIN,
      { ...REFRESH_REJECTED, delayMs: 10 },
      LOGIN,
    ]);
    await header(manager);
    clock.value += ACCESS_LIFETIME_MS;
    const pending = captureAsync(header(manager));
    lifecycle.close();
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

  it('cools down after a 429 whose body read fails', async () => {
    const clock = { value: 1_700_000_000_000 };
    const fetchImpl = vi.fn<FetchLike>(() => {
      const body = new ReadableStream({
        pull: (controller) => {
          controller.error(new TypeError('terminated'));
        },
      });
      return Promise.resolve(new Response(body, { status: 429 }));
    });
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
    clock.value += 59_999;
    await expect(header(manager)).rejects.toBe(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

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

describe('401 replay end to end', () => {
  it('refreshes and replays the request once', async () => {
    const { manager, http, fetchImpl } = setup([LOGIN, EXPIRED, REFRESHED, SUCCESS]);
    await expect(http.request(GET_STATUS)).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
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
    const error = await expectApiError(http.request(CREATE_RECEIPT), {
      code: 'permission_denied',
      httpStatus: 401,
    });
    expect(fetchImpl.calls).toHaveLength(4);
    expectNoSecrets(error);
  });

  it('a bare 401 neither replays nor invalidates the token', async () => {
    const { http, fetchImpl } = setup([LOGIN, { status: 401, rawBody: '' }, SUCCESS]);
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({ code: 'sdk_unexpected_status' });
    await expect(http.request(GET_STATUS)).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, RESOURCE_PATH, RESOURCE_PATH]);
  });

  it('ignores an out-of-order stale 401 instead of invalidating the newer token', async () => {
    const { http, fetchImpl } = setup([
      LOGIN,
      { ...EXPIRED, delayMs: 10 },
      { ...EXPIRED, delayMs: 40 },
      REFRESHED,
      SUCCESS,
      SUCCESS,
    ]);
    const results = await Promise.all([http.request(GET_STATUS), http.request(GET_STATUS)]);
    expect(results.map((result) => result.payload)).toEqual([SUCCESS_PAYLOAD, SUCCESS_PAYLOAD]);
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
    const { http, fetchImpl } = setup([{ ...LOGIN, delayMs: 20 }, SUCCESS]);
    const controller = new AbortController();
    const aborted = captureAsync(http.request(GET_STATUS, { signal: controller.signal }));
    const other = http.request(GET_STATUS);
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ code: 'sdk_aborted' });
    await expect(other).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
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
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({ code: 'sdk_client_closed' });
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('does no I/O when no token was ever issued', async () => {
    const { manager, fetchImpl } = setup([]);
    await manager.close();
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('shares one revocation between concurrent and repeated calls', async () => {
    const { manager, fetchImpl } = setup([LOGIN, { ...REVOKED, delayMs: 10 }]);
    await header(manager);
    const first = manager.close();
    const second = manager.close();
    await Promise.all([first, second, manager.close()]);
    await manager.close();
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, REVOKE_PATH]);
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
  ] as const)(
    'resolves after %s and leaves it to the logger',
    async (_label, failure, httpStatus, errorCode) => {
      const events: PaylovLoggerResponseEvent[] = [];
      const { manager, fetchImpl } = setup([LOGIN, failure], {
        onResponse: (event) => void events.push(event),
      });
      await header(manager);
      await expect(manager.close()).resolves.toBeUndefined();
      expect(events.at(-1)).toMatchObject({
        endpoint: `POST ${REVOKE_PATH}`,
        httpStatus,
        errorCode,
      });
      expectNoSecrets(events);
      await expect(manager.authorize()).rejects.toMatchObject({ code: 'sdk_client_closed' });
      expect(fetchImpl.calls).toHaveLength(2);
    },
  );

  it('waits for an in-flight grant, fails its waiters and revokes the newest token', async () => {
    const { manager, fetchImpl } = setup([{ ...LOGIN, delayMs: 20 }, REVOKED]);
    const waiter = captureAsync(manager.authorize());
    await Promise.resolve();
    await manager.close();
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

  it('still closes when the in-flight grant fails', async () => {
    const { manager, fetchImpl } = setup([{ ...NETWORK_FAILURE, delayMs: 10 }]);
    const waiter = captureAsync(manager.authorize());
    await manager.close();
    await expect(waiter).resolves.toBeInstanceOf(PaylovConnectionError);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('fails a request in flight that the revocation rejects, without re-sending it', async () => {
    const { manager, http, fetchImpl } = setup([LOGIN, { ...EXPIRED, delayMs: 20 }, REVOKED]);
    await header(manager);
    const inFlight = captureAsync(http.request(CREATE_RECEIPT));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await manager.close();
    const error = await inFlight;
    expect(error).toBeInstanceOf(PaylovClientClosedError);
    expect(isPaylovOutcomeUnknown(error)).toBe(false);
    expect(pathsOf(fetchImpl.calls)).toEqual([TOKEN_PATH, CREATE_RECEIPT.route, REVOKE_PATH]);
  });

  it('resolves when a signal abandons the wait, and still revokes', async () => {
    const { manager, fetchImpl } = setup([LOGIN, { ...REVOKED, delayMs: 20 }]);
    await header(manager);
    const controller = new AbortController();
    const abandoned = manager.close(controller.signal);
    controller.abort();
    await expect(abandoned).resolves.toBeUndefined();
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

  it('names the failing field under body', async () => {
    const { manager } = setup([{ body: { ...PASSWORD_TOKEN, expires_in: 0 } }]);
    await expectMalformed(header(manager), 'body.expires_in');
  });
});
