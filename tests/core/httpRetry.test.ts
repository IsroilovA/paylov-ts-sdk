import { describe, expect, it, vi } from 'vitest';

import {
  PaylovApiError,
  PaylovConnectionError,
  PaylovProtocolError,
  isPaylovOutcomeUnknown,
} from '../../src/core/errors.js';
import { createHttpClient } from '../../src/core/http.js';
import { ClientLifecycle, untilAborted } from '../../src/core/lifecycle.js';
import type {
  AuthorizationContext,
  AuthProvider,
  FetchLike,
  PaylovLoggerResponseEvent,
} from '../../src/core/types.js';
import { captureAsync, expectNoSecretLeak, recordOf } from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { wireResponse } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/testHttp.js';
import {
  PASSWORD,
  PAN,
  SUCCESS,
  SUCCESS_PAYLOAD,
  FUNDS_ERROR,
  NETWORK_FAILURE,
  GET_STATUS,
  CREATE_RECEIPT,
  client,
  rotatingAuth,
} from './httpCases.js';

const EXPIRED = wireResponse('envelope/bearer.expired.wire.json');
const BARE_401: FakeResponseSpec = { status: 401, rawBody: 'Unauthorized' };
const STALLED: FakeResponseSpec = { delayMs: 5_000, ...SUCCESS };

function aborted(): Error {
  return new Error('aborted');
}

function recordingSleep(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

describe('deadlines and connection failures', () => {
  it('aborts the fetch and reports sdk_timeout', async () => {
    const { http, fetchImpl } = client([STALLED, STALLED, STALLED], { timeoutMs: 30 });
    const error = await captureAsync(http.request(GET_STATUS));
    expect(error).toBeInstanceOf(PaylovConnectionError);
    expect(error).toMatchObject({
      code: 'sdk_timeout',
      timeoutMs: 30,
      endpoint: 'GET /merchant/status/',
    });
    expect(fetchImpl.calls[0]?.signal?.aborted).toBe(true);
  });

  it('covers a body read that ignores the abort signal', async () => {
    const stalled = new Response(
      new ReadableStream({ pull: () => new Promise<void>(() => undefined) }),
    );
    const http = createHttpClient({
      origin: BASE_URL,
      timeoutMs: 30,
      fetch: () => Promise.resolve(stalled),
    });
    await expect(http.request(CREATE_RECEIPT)).rejects.toMatchObject({
      code: 'sdk_timeout',
      timeoutMs: 30,
    });
  });

  it('covers a fetch that ignores the abort signal', async () => {
    const http = createHttpClient({
      origin: BASE_URL,
      timeoutMs: 30,
      fetch: () => new Promise<Response>(() => undefined),
    });
    await expect(http.request(CREATE_RECEIPT)).rejects.toMatchObject({ code: 'sdk_timeout' });
  });

  it('retains no fetch-error data anywhere in the public error', async () => {
    const secrets = {
      authorization: 'Bearer EXAMPLE-PRIVATE-ACCESS-TOKEN',
      password: 'EXAMPLE-PRIVATE-PASSWORD',
      refreshToken: 'EXAMPLE-PRIVATE-REFRESH-TOKEN',
      otp: 'EXAMPLE-PRIVATE-OTP',
      query: 'EXAMPLE-PRIVATE-QUERY-TOKEN',
    } as const;
    const nested = new Error(`proxy failed with ${secrets.refreshToken}`);
    Object.defineProperty(nested, 'hiddenAuthorization', {
      value: secrets.authorization,
      enumerable: false,
    });
    const cause = Object.assign(
      new TypeError(
        `${BASE_URL}/merchant/status/?externalId=${secrets.query} ${secrets.password}`,
        { cause: nested },
      ),
      {
        request: {
          headers: { authorization: secrets.authorization },
          body: { otp: secrets.otp, cardNumber: PAN },
        },
      },
    );
    const failure = { throw: cause };
    const { http } = client([failure, failure, failure]);
    const error = await captureAsync(
      http.request(GET_STATUS, { query: { externalId: secrets.query } }),
    );
    expect(error).toBeInstanceOf(PaylovConnectionError);
    expect(error).toMatchObject({ code: 'sdk_network_error' });
    expect(recordOf(error)['cause']).toBeUndefined();
    expectNoSecretLeak(error, [BASE_URL, PAN, ...Object.values(secrets)]);
  });

  it('uses the platform fetch when none is injected', async () => {
    const platformFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(SUCCESS.body)));
    vi.stubGlobal('fetch', platformFetch);
    try {
      const http = createHttpClient({ origin: BASE_URL });
      await expect(http.request(GET_STATUS)).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
      expect(platformFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('caller abort', () => {
  it('fails before any I/O when the signal is already aborted, with a known outcome', async () => {
    const { auth, authorize } = rotatingAuth();
    const { http, fetchImpl } = client([SUCCESS], { auth });
    const error = await captureAsync(http.request(CREATE_RECEIPT, { signal: AbortSignal.abort() }));
    expect(error).toMatchObject({
      code: 'sdk_aborted',
      endpoint: 'POST /merchant/receipts/create/',
      isSent: false,
    });
    expect(isPaylovOutcomeUnknown(error)).toBe(false);
    expect(recordOf(error)['timeoutMs']).toBeUndefined();
    expect(authorize).not.toHaveBeenCalled();
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('aborts an in-flight GET and never retries it', async () => {
    const controller = new AbortController();
    const { http, fetchImpl } = client([STALLED, SUCCESS]);
    const pending = captureAsync(http.request(GET_STATUS, { signal: controller.signal }));
    controller.abort();
    await expect(pending).resolves.toMatchObject({ code: 'sdk_aborted', isSent: true });
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]?.signal?.aborted).toBe(true);
  });

  it('abandons a backoff sleep', async () => {
    const controller = new AbortController();
    const sleep = (): Promise<void> => {
      controller.abort();
      return new Promise<void>(() => undefined);
    };
    const { http, fetchImpl } = client([{ status: 503 }, SUCCESS], { sleep });
    await expect(http.request(GET_STATUS, { signal: controller.signal })).rejects.toMatchObject({
      code: 'sdk_aborted',
      isSent: true,
    });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('stops waiting for authorization without cancelling it', async () => {
    const controller = new AbortController();
    const grant = Promise.withResolvers<AuthorizationContext>();
    const auth: AuthProvider = {
      authorize: () => grant.promise,
      invalidate: vi.fn<AuthProvider['invalidate']>(),
    };
    const { http, fetchImpl } = client([SUCCESS], { auth });
    const waiting = captureAsync(http.request(GET_STATUS, { signal: controller.signal }));
    const other = http.request(GET_STATUS);
    controller.abort();
    await expect(waiting).resolves.toMatchObject({ code: 'sdk_aborted', isSent: false });
    grant.resolve({ header: 'Bearer shared', generation: 1 });
    await expect(other).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('untilAborted passes other rejections through', async () => {
    const failure = new Error('grant failed');
    await expect(
      untilAborted(Promise.reject(failure), new AbortController().signal, aborted),
    ).rejects.toBe(failure);
    await expect(untilAborted(Promise.resolve(1), undefined, aborted)).resolves.toBe(1);
  });
});

describe('client lifecycle', () => {
  it('refuses every send once closed', async () => {
    const lifecycle = new ClientLifecycle();
    const { http, fetchImpl } = client([SUCCESS], { lifecycle });
    expect(lifecycle.closed).toBe(false);
    lifecycle.close();
    expect(lifecycle.closed).toBe(true);
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({ code: 'sdk_client_closed' });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('refuses a send whose authorization resolved after close', async () => {
    const lifecycle = new ClientLifecycle();
    const auth: AuthProvider = {
      authorize: () => {
        lifecycle.close();
        return Promise.resolve({ header: 'Bearer late', generation: 1 });
      },
      invalidate: vi.fn<AuthProvider['invalidate']>(),
    };
    const { http, fetchImpl } = client([SUCCESS], { lifecycle, auth });
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({ code: 'sdk_client_closed' });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it.each([
    ['closes the client', 'sdk_client_closed'],
    ['aborts the call', 'sdk_aborted'],
  ] as const)(
    'sends nothing when the request hook %s, and closes the attempt',
    async (_label, code) => {
      const lifecycle = new ClientLifecycle();
      const controller = new AbortController();
      const onResponse = vi.fn<(event: PaylovLoggerResponseEvent) => void>();
      const onRequest = (): void => {
        if (code === 'sdk_client_closed') lifecycle.close();
        else controller.abort();
      };
      const { http, fetchImpl } = client([SUCCESS], {
        lifecycle,
        logger: { onRequest, onResponse },
      });
      await expect(
        http.request(CREATE_RECEIPT, { signal: controller.signal }),
      ).rejects.toMatchObject({ code });
      expect(fetchImpl.calls).toHaveLength(0);
      expect(onResponse.mock.calls.map(([event]) => event)).toEqual([
        expect.objectContaining({ attempt: 1, httpStatus: 0, errorCode: code }),
      ]);
    },
  );

  it('refuses a GET retry after close', async () => {
    const lifecycle = new ClientLifecycle();
    const sleep = (): Promise<void> => {
      lifecycle.close();
      return Promise.resolve();
    };
    const { http, fetchImpl } = client([{ status: 503 }, SUCCESS], { lifecycle, sleep });
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({ code: 'sdk_client_closed' });
    expect(fetchImpl.calls).toHaveLength(1);
  });
});

describe('GET retries', () => {
  it('makes one attempt for a success and unwraps its result', async () => {
    const { http, fetchImpl } = client([SUCCESS]);
    await expect(http.request(GET_STATUS)).resolves.toEqual({
      payload: SUCCESS_PAYLOAD,
      context: { endpoint: 'GET /merchant/status/', httpStatus: 200 },
    });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('retries a 500 up to the 2-retry ceiling, then throws its error', async () => {
    const serverError = wireResponse('envelope/serverError.wire.json');
    const { http, fetchImpl } = client([serverError, serverError, serverError]);
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({
      code: 'server_error',
      httpStatus: 500,
    });
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it.each([502, 503, 504])('retries a %i and returns the later payload', async (status) => {
    const { http, fetchImpl } = client([{ status }, { status }, SUCCESS]);
    await expect(http.request(GET_STATUS)).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it.each([
    ['network error', NETWORK_FAILURE, {}],
    ['timeout', { delayMs: 5_000 }, { timeoutMs: 30 }],
  ] as const)('retries a pre-response %s', async (_label, failure, overrides) => {
    const { http, fetchImpl } = client([failure, SUCCESS], overrides);
    await http.request(GET_STATUS);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('does not retry a 400', async () => {
    const { http, fetchImpl } = client([FUNDS_ERROR]);
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('never retries a 429 and surfaces its retryAfterSeconds', async () => {
    const { sleeps, sleep } = recordingSleep();
    const { http, fetchImpl } = client(
      [wireResponse('auth/token.rateLimitedRetryAfter.wire.json'), SUCCESS],
      { sleep },
    );
    const error = await captureAsync(http.request(GET_STATUS));
    expect(error).toBeInstanceOf(PaylovApiError);
    expect(error).toMatchObject({
      code: 'rate_limit_exceeded',
      httpStatus: 429,
      retryAfterSeconds: 48,
    });
    expect(fetchImpl.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('reports a 429 whose body read failed as a status error, logged and never retried', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => {
      const body = new ReadableStream({
        pull: (controller) => {
          controller.error(new TypeError('terminated'));
        },
      });
      return Promise.resolve(new Response(body, { status: 429 }));
    });
    const onResponse = vi.fn<(event: PaylovLoggerResponseEvent) => void>();
    const { http } = client([], { fetch: fetchImpl, logger: { onResponse } });
    const error = await captureAsync(http.request(GET_STATUS));
    expect(error).toBeInstanceOf(PaylovProtocolError);
    expect(error).toMatchObject({ code: 'sdk_unexpected_status', httpStatus: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onResponse.mock.calls.map(([event]) => event.httpStatus)).toEqual([429]);
  });

  it('keeps a caller abort during a 429 body read as sdk_aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<FetchLike>(() => {
      const body = new ReadableStream(
        {
          pull: () => {
            controller.abort();
            return new Promise<void>(() => undefined);
          },
        },
        { highWaterMark: 0 },
      );
      return Promise.resolve(new Response(body, { status: 429 }));
    });
    const { http } = client([], { fetch: fetchImpl });
    const error = await captureAsync(http.request(GET_STATUS, { signal: controller.signal }));
    expect(error).toBeInstanceOf(PaylovConnectionError);
    expect(error).toMatchObject({ code: 'sdk_aborted' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, [200, 400]],
    [0, [100, 200]],
  ])('backs off exponentially with jitter factor random()=%s', async (randomValue, expected) => {
    const { sleeps, sleep } = recordingSleep();
    const { http } = client([{ status: 500 }, { status: 500 }, { status: 500 }], {
      sleep,
      random: () => randomValue,
    });
    await expect(http.request(GET_STATUS)).rejects.toBeInstanceOf(PaylovProtocolError);
    expect(sleeps).toEqual(expected);
  });

  it('waits the default backoff, with the default jitter, before retrying', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], fakeNodeBuiltins: true });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { fetchImpl } = client([{ status: 503 }, SUCCESS]);
      const http = createHttpClient({ origin: BASE_URL, fetch: fetchImpl });
      const pending = http.request(GET_STATUS);
      await vi.advanceTimersByTimeAsync(99);
      expect(fetchImpl.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl.calls).toHaveLength(2);
      await expect(pending).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

describe('non-GET requests are never retried', () => {
  it.each([
    ['500', { status: 500 }, {}, 'sdk_unexpected_status'],
    ['503', { status: 503 }, {}, 'sdk_unexpected_status'],
    ['network error', NETWORK_FAILURE, {}, 'sdk_network_error'],
    ['timeout', { delayMs: 5_000 }, { timeoutMs: 30 }, 'sdk_timeout'],
  ] as const)('makes exactly one attempt after a %s', async (_label, failure, overrides, code) => {
    for (const method of ['POST', 'DELETE'] as const) {
      const { http, fetchImpl } = client([failure, SUCCESS], overrides);
      await expect(http.request({ ...CREATE_RECEIPT, method })).rejects.toMatchObject({ code });
      expect(fetchImpl.calls).toHaveLength(1);
    }
  });
});

describe('401 replay', () => {
  it('invalidates the rejected generation and replays a GET once', async () => {
    const { auth, authorize, invalidate } = rotatingAuth();
    const { http, fetchImpl } = client([EXPIRED, SUCCESS], { auth });
    await expect(http.request(GET_STATUS)).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
    expect(invalidate.mock.calls).toEqual([[1]]);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(fetchImpl.calls.map((call) => call.headers['authorization'])).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('replays a POST once, because the rejected request never executed', async () => {
    const { auth, invalidate } = rotatingAuth();
    const { http, fetchImpl } = client(
      [wireResponse('envelope/bearer.invalidToken.wire.json'), SUCCESS],
      { auth },
    );
    await http.request(CREATE_RECEIPT);
    expect(fetchImpl.calls).toHaveLength(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a second permission_denied after exactly two attempts', async () => {
    const { auth, invalidate } = rotatingAuth();
    const { http, fetchImpl } = client([EXPIRED, EXPIRED], { auth });
    const error = await captureAsync(
      http.request(CREATE_RECEIPT, { body: { password: PASSWORD } }),
    );
    expect(error).toBeInstanceOf(PaylovApiError);
    expect(error).toMatchObject({
      code: 'permission_denied',
      httpStatus: 401,
    });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expectNoSecretLeak(error, [PASSWORD]);
  });

  it.each([
    ['bare 401', BARE_401, 'sdk_unexpected_status'],
    [
      '401 with another code',
      { status: 401, body: { result: null, error: { code: 'invalid_token' } } },
      'invalid_token',
    ],
    [
      '400 permission_denied',
      { status: 400, body: { result: null, error: { code: 'permission_denied' } } },
      'permission_denied',
    ],
    [
      '403 permission_denied',
      { status: 403, body: { result: null, error: { code: 'permission_denied' } } },
      'permission_denied',
    ],
    [
      '403 ip_not_allowed',
      { status: 403, body: { result: null, error: { code: 'ip_not_allowed' } } },
      'ip_not_allowed',
    ],
  ] as const)('does not replay a %s', async (_label, response, code) => {
    const { auth, invalidate } = rotatingAuth();
    const { http, fetchImpl } = client([response, SUCCESS], { auth });
    await expect(http.request(CREATE_RECEIPT)).rejects.toMatchObject({ code });
    expect(fetchImpl.calls).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('never replays without an AuthProvider', async () => {
    const { http, fetchImpl } = client([EXPIRED, SUCCESS]);
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({ code: 'permission_denied' });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it.each([
    ['network failure', NETWORK_FAILURE, {}, 'sdk_network_error'],
    ['timeout', { delayMs: 5_000 }, { timeoutMs: 30 }, 'sdk_timeout'],
    ['500', { status: 500 }, {}, 'sdk_unexpected_status'],
  ] as const)(
    'stops a POST after a failed replay: %s',
    async (_label, failure, overrides, code) => {
      const { auth, invalidate } = rotatingAuth();
      const { http, fetchImpl } = client([EXPIRED, failure, SUCCESS], { auth, ...overrides });
      await expect(http.request(CREATE_RECEIPT)).rejects.toMatchObject({ code });
      expect(fetchImpl.calls).toHaveLength(2);
      expect(invalidate).toHaveBeenCalledTimes(1);
    },
  );

  it('does not spend the GET retry budget on the replay', async () => {
    const { auth } = rotatingAuth();
    const { http, fetchImpl } = client(
      [EXPIRED, { status: 500 }, { status: 500 }, { status: 500 }],
      { auth },
    );
    await expect(http.request(GET_STATUS)).rejects.toBeInstanceOf(PaylovProtocolError);
    expect(fetchImpl.calls).toHaveLength(4);
  });
});
