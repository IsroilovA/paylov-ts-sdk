import { describe, expect, it, vi } from 'vitest';

import {
  PaylovApiError,
  PaylovConnectionError,
  PaylovProtocolError,
} from '../../src/core/errors.js';
import { createHttpClient } from '../../src/core/http.js';
import type {
  FetchLike,
  PaylovLoggerRequestEvent,
  PaylovLoggerResponseEvent,
} from '../../src/core/types.js';
import { basicAuthHeader, captureAsync, expectNoSecretLeak, recordOf } from '../helpers/asserts.js';
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
  RECEIPT_BODY,
  client,
  rotatingAuth,
} from './httpCases.js';

const CONSUMER_SECRET = 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL';

function explode(): never {
  throw new Error('logger exploded');
}

function explodeAsync(): Promise<void> {
  return Promise.reject(new Error('async logger exploded'));
}

describe('request construction', () => {
  it('joins the url, encodes query values and drops undefined ones', async () => {
    const { http, fetchImpl } = client([SUCCESS, SUCCESS]);
    await http.request(GET_STATUS);
    await http.request(
      { ...GET_STATUS, route: '/merchant/payment/hold/status/' },
      { query: { externalId: 'a b&c', transactionId: undefined, page: 2, refunded: false } },
    );
    expect(fetchImpl.calls.map((call) => call.url)).toEqual([
      `${BASE_URL}/merchant/status/`,
      `${BASE_URL}/merchant/payment/hold/status/?externalId=a%20b%26c&page=2&refunded=false`,
    ]);
  });

  it('rejects a query value with a lone surrogate before any I/O', async () => {
    const { http, fetchImpl } = client([SUCCESS]);
    await expect(
      http.request(GET_STATUS, { query: { externalId: '\ud800' } }),
    ).rejects.toMatchObject({
      code: 'sdk_invalid_input',
      field: 'externalId',
      rule: 'format',
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('percent-encodes each path value as one segment', async () => {
    const { http, fetchImpl } = client([SUCCESS]);
    const route = '/merchant/{kind}/{token}/';
    await http.request({ ...GET_STATUS, route }, { path: { kind: 'bind', token: 'a/b c' } });
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/bind/a%2Fb%20c/`);
  });

  it.each(['.', '..', '\ud800'])(
    'rejects the path value %j before any I/O, naming the placeholder',
    async (cardId) => {
      const { http, fetchImpl } = client([SUCCESS]);
      const endpoint = { ...GET_STATUS, route: '/merchant/userCard/{cardId}/' } as const;
      await expect(http.request(endpoint, { path: { cardId } })).rejects.toMatchObject({
        code: 'sdk_invalid_input',
        field: 'cardId',
        rule: 'format',
      });
      expect(fetchImpl.calls).toHaveLength(0);
    },
  );

  it('adds content-type only with a body and keeps per-request headers', async () => {
    const { http, fetchImpl } = client([SUCCESS, SUCCESS]);
    await http.request(GET_STATUS, { headers: { 'x-trace': 'per-request' } });
    await http.request(CREATE_RECEIPT, RECEIPT_BODY);
    expect(fetchImpl.calls[0]?.headers).toEqual({
      accept: 'application/json',
      'x-trace': 'per-request',
    });
    expect(fetchImpl.calls[1]?.headers['content-type']).toBe('application/json');
    expect(fetchImpl.calls[1]?.body).toEqual({ amount: 1 });
  });

  it('names the endpoint by its route template', async () => {
    const { http } = client([FUNDS_ERROR]);
    const error = await captureAsync(
      http.request(
        { ...GET_STATUS, route: '/merchant/userCard/{cardId}/' },
        { path: { cardId: '5eed0000-0000-4000-8000-000000000001' } },
      ),
    );
    expect(error).toMatchObject({ endpoint: 'GET /merchant/userCard/{cardId}/' });
  });

  it('asks the AuthProvider once per attempt', async () => {
    const { auth, authorize } = rotatingAuth();
    const { http, fetchImpl } = client([SUCCESS], { auth });
    await http.request(GET_STATUS);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(fetchImpl.calls[0]?.headers['authorization']).toBe('Bearer token-1');
  });

  it.each(['GET', 'POST', 'DELETE'] as const)(
    'does not follow or retry a redirect for %s',
    async (method) => {
      for (const status of [301, 302, 303, 307, 308]) {
        const cancel = vi.fn<() => Promise<void>>(() => Promise.resolve());
        const fetchImpl = vi.fn<FetchLike>((_url, init) => {
          expect(init.redirect).toBe('manual');
          const body = new ReadableStream({ cancel });
          return Promise.resolve(
            new Response(body, { status, headers: { location: 'https://redirect.example/' } }),
          );
        });
        const http = createHttpClient({ origin: BASE_URL, fetch: fetchImpl });
        await expect(
          http.request({ method, route: '/merchant/payment/', shape: 'envelope' }),
        ).rejects.toMatchObject({
          code: 'sdk_unexpected_status',
          httpStatus: status,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledTimes(1);
      }
    },
  );
});

describe('response normalization', () => {
  it('throws the gateway error with the endpoint identity only', async () => {
    const { http } = client([FUNDS_ERROR]);
    const error = await captureAsync(
      http.request(CREATE_RECEIPT, {
        query: { token: 'EXAMPLE-QUERY-SECRET' },
        body: { password: PASSWORD },
      }),
    );
    expect(error).toMatchObject({
      code: 'insufficient_funds',
      endpoint: 'POST /merchant/receipts/create/',
    });
    expect(error).not.toHaveProperty('requestId');
    expectNoSecretLeak(error, [PASSWORD, 'EXAMPLE-QUERY-SECRET']);
  });

  it('applies the declared shape', async () => {
    const { http } = client([wireResponse('auth/revoke.success.wire.json')]);
    await expect(http.request({ ...CREATE_RECEIPT, shape: 'flat' })).resolves.toMatchObject({
      payload: { status: 'success' },
    });
  });

  it('turns a non-JSON 5xx body into sdk_unexpected_status', async () => {
    const html: FakeResponseSpec = { status: 500, rawBody: '<html>Bad gateway</html>' };
    const { http } = client([html, html, html]);
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({
      code: 'sdk_unexpected_status',
      httpStatus: 500,
    });
  });

  it('turns a non-JSON 2xx body into sdk_malformed_response', async () => {
    const { http } = client([{ rawBody: 'OK' }]);
    await expect(http.request(GET_STATUS)).rejects.toMatchObject({
      code: 'sdk_malformed_response',
    });
  });
});

describe('metadata logging', () => {
  it('logs only metadata while sending the real credentials on the wire', async () => {
    const onRequest = vi.fn<(event: PaylovLoggerRequestEvent) => void>();
    const onResponse = vi.fn<(event: PaylovLoggerResponseEvent) => void>();
    const { http, fetchImpl } = client([wireResponse('auth/token.passwordSuccess.wire.json')], {
      logger: { onRequest, onResponse },
    });
    await http.request(
      { method: 'POST', route: '/merchant/oauth2/token/', shape: 'flat' },
      {
        headers: { authorization: basicAuthHeader('app_key', CONSUMER_SECRET) },
        body: { grant_type: 'password', username: 'merchant-user', password: PASSWORD },
      },
    );
    const endpoint = 'POST /merchant/oauth2/token/';
    expect(onRequest.mock.calls).toStrictEqual([[{ method: 'POST', endpoint, attempt: 1 }]]);
    const durationMs: unknown = expect.any(Number);
    expect(onResponse.mock.calls).toStrictEqual([
      [{ method: 'POST', endpoint, attempt: 1, httpStatus: 200, durationMs }],
    ]);
    expect(fetchImpl.calls[0]?.headers['authorization']).toBe(
      basicAuthHeader('app_key', CONSUMER_SECRET),
    );
    expect(recordOf(fetchImpl.calls[0]?.body)['password']).toBe(PASSWORD);
  });

  it('never exposes a request or response body to logger hooks', async () => {
    const secret = 'EXAMPLE-PROXY-SECRET-NOT-A-REAL-VALUE';
    const events: unknown[] = [];
    const record = (event: unknown): void => {
      events.push(event);
    };
    const { http } = client([{ status: 502, rawBody: `<html>${secret}</html>` }], {
      logger: { onRequest: record, onResponse: record },
    });
    await expect(
      http.request(CREATE_RECEIPT, {
        body: { account: { arbitrary: secret }, pan: PAN },
        headers: { 'x-custom': secret },
      }),
    ).rejects.toBeInstanceOf(PaylovProtocolError);
    expect(events).toHaveLength(2);
    expectNoSecretLeak(events, [secret, PAN]);
  });

  it('reports the validated gateway error code', async () => {
    const onResponse = vi.fn<(event: PaylovLoggerResponseEvent) => void>();
    const { http } = client([FUNDS_ERROR], { logger: { onResponse } });
    await expect(http.request(CREATE_RECEIPT)).rejects.toBeInstanceOf(PaylovApiError);
    expect(onResponse.mock.calls[0]?.[0]).toMatchObject({ errorCode: 'insufficient_funds' });
  });

  it('closes an attempt that got no response with a status-0 event', async () => {
    const onResponse = vi.fn<(event: PaylovLoggerResponseEvent) => void>();
    const { http } = client([NETWORK_FAILURE, { delayMs: 5_000 }], {
      logger: { onResponse },
      timeoutMs: 30,
    });
    await expect(http.request(CREATE_RECEIPT)).rejects.toBeInstanceOf(PaylovConnectionError);
    await expect(http.request(CREATE_RECEIPT)).rejects.toBeInstanceOf(PaylovConnectionError);
    expect(onResponse.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ attempt: 1, httpStatus: 0, errorCode: 'sdk_network_error' }),
      expect.objectContaining({ attempt: 1, httpStatus: 0, errorCode: 'sdk_timeout' }),
    ]);
    expectNoSecretLeak(onResponse.mock.calls, ['fetch failed', BASE_URL]);
  });

  it('numbers retried attempts', async () => {
    const onRequest = vi.fn<(event: PaylovLoggerRequestEvent) => void>();
    const { http } = client([{ status: 503 }, SUCCESS], { logger: { onRequest } });
    await http.request(GET_STATUS);
    expect(onRequest.mock.calls.map(([event]) => event.attempt)).toEqual([1, 2]);
  });

  it('survives logger hooks that throw or reject', async () => {
    for (const logger of [
      { onRequest: explode, onResponse: explode },
      { onRequest: explodeAsync, onResponse: explodeAsync },
    ]) {
      const { http } = client([SUCCESS], { logger });
      await expect(http.request(GET_STATUS)).resolves.toMatchObject({ payload: SUCCESS_PAYLOAD });
    }
  });
});
