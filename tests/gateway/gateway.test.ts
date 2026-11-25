import { describe, expect, it } from 'vitest';

import { PaylovClient, type PaylovClientConfig } from '../../src/client.js';
import { createGatewayResource } from '../../src/gateway/resource.js';
import {
  basicAuthHeader,
  expectApiError,
  expectMalformed,
  expectNoSecretLeak,
} from '../helpers/asserts.js';
import { createFakeFetch, type FakeResponseSpec } from '../helpers/fakeFetch.js';
import { loadFixture, loadWire, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL, recordingLogger, setupResource } from '../helpers/testHttp.js';

const STATUS_URL = `${BASE_URL}/merchant/status/`;
const BANK_LIST_URL = `${BASE_URL}/merchant/bankList/`;
const TOKEN_URL = `${BASE_URL}/merchant/oauth2/token/`;

const STATUS_OK = wireResponse('gateway/getStatus.ok.wire.json');
const BANK_LIST = wireResponse('gateway/listBanks.success.wire.json');
const LOGIN = wireResponse('auth/token.passwordSuccess.wire.json');

const CONSUMER_KEY = 'EXAMPLE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL';
const CONSUMER_SECRET = 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL';
const USERNAME = 'EXAMPLE-USERNAME-NOT-A-REAL-CREDENTIAL';
const PASSWORD = 'EXAMPLE-PASSWORD-NOT-A-REAL-CREDENTIAL';

interface WireToken {
  readonly access_token: string;
  readonly refresh_token: string;
}
const TOKEN = loadWire('auth/token.passwordSuccess.wire.json').body as WireToken;

const CONFIG: PaylovClientConfig = {
  baseUrl: BASE_URL,
  consumerKey: CONSUMER_KEY,
  consumerSecret: CONSUMER_SECRET,
  username: USERNAME,
  password: PASSWORD,
};

function setupGateway(script: FakeResponseSpec[]) {
  return setupResource((http) => createGatewayResource(http, http), script);
}

function setupClient(script: FakeResponseSpec[], overrides: Partial<PaylovClientConfig> = {}) {
  const fetchImpl = createFakeFetch(script);
  return { client: new PaylovClient({ ...CONFIG, ...overrides, fetch: fetchImpl }), fetchImpl };
}

describe('gateway.getStatus', () => {
  it('sends GET /merchant/status/ and resolves for {"status":"ok"}', async () => {
    const { resource, fetchImpl } = setupGateway([STATUS_OK]);
    await expect(resource.getStatus()).resolves.toBeUndefined();
    expect(fetchImpl.calls).toMatchObject([{ url: STATUS_URL, method: 'GET', body: undefined }]);
  });

  it('rejects any other success body', async () => {
    for (const [body, path] of [
      [{ status: 'down' }, 'body.status'],
      [{}, 'body.status'],
      [{ result: { status: 'ok' }, error: null }, 'body.status'],
      [['ok'], undefined],
    ] as const) {
      const { resource } = setupGateway([{ body }]);
      await expectMalformed(resource.getStatus(), path);
    }
  });

  it('surfaces a gateway error code', async () => {
    const { resource } = setupGateway([
      wireResponse('gateway/getStatus.methodNotAllowed.wire.json'),
    ]);
    const error = await expectApiError(resource.getStatus(), {
      code: 'method_not_allowed',
      httpStatus: 405,
    });
    expect(error.endpoint).toBe('GET /merchant/status/');
  });
});

describe('gateway.listBanks', () => {
  it('decodes the bare array with string bank ids and verbatim names', async () => {
    const { resource, fetchImpl } = setupGateway([BANK_LIST]);
    const banks = await resource.listBanks();
    expect(banks).toHaveLength(37);
    expect([banks[0], banks[13], banks[26]]).toStrictEqual([
      { bankId: '1', name: 'Hamkorbank', officialName: null },
      { bankId: '14', name: 'O`zsanoatqurilishbank', officialName: null },
      { bankId: '28', name: 'O‘zagroeksportbank', officialName: null },
    ]);
    expect(fetchImpl.calls).toMatchObject([{ url: BANK_LIST_URL, method: 'GET', body: undefined }]);
  });

  it('keeps an official name when Paylov has one', async () => {
    const body = loadFixture('gateway/listBanks.officialName.synthesized.json');
    const { resource } = setupGateway([{ body }]);
    await expect(resource.listBanks()).resolves.toStrictEqual([
      { bankId: '38', name: 'EXAMPLE-BANK', officialName: 'EXAMPLE-BANK-OFFICIAL-NAME' },
    ]);
  });

  it('rejects a malformed list at the failing path', async () => {
    const bank = { id: 1, name: 'Hamkorbank', official_name: null };
    for (const [body, path] of [
      [{ result: [bank], error: null }, undefined],
      [[null], 'body[0]'],
      [[bank, { ...bank, id: '2' }], 'body[1].id'],
      [[{ ...bank, id: 1.5 }], 'body[0].id'],
      [[{ ...bank, id: -1 }], 'body[0].id'],
      [[{ id: 1, official_name: null }], 'body[0].name'],
      [[{ id: 1, name: 'Hamkorbank' }], 'body[0].official_name'],
      [[{ ...bank, official_name: 7 }], 'body[0].official_name'],
    ] as const) {
      const { resource } = setupGateway([{ body }]);
      await expectMalformed(resource.listBanks(), path);
    }
  });
});

describe('gateway through PaylovClient', () => {
  it('logs in with Basic on the token endpoint, then lists banks with Bearer', async () => {
    const { client, fetchImpl } = setupClient([LOGIN, BANK_LIST]);
    await expect(client.gateway.listBanks()).resolves.toHaveLength(37);
    expect(fetchImpl.calls.map((call) => [call.url, call.headers['authorization']])).toEqual([
      [TOKEN_URL, basicAuthHeader(CONSUMER_KEY, CONSUMER_SECRET)],
      [BANK_LIST_URL, `Bearer ${TOKEN.access_token}`],
    ]);
    expect(fetchImpl.calls[0]?.body).toStrictEqual({
      grant_type: 'password',
      username: USERNAME,
      password: PASSWORD,
    });
  });

  it('checks the status without a token request or an Authorization header', async () => {
    const { client, fetchImpl } = setupClient([STATUS_OK]);
    await client.gateway.getStatus();
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]?.url).toBe(STATUS_URL);
    expect(fetchImpl.calls[0]?.headers).not.toHaveProperty('authorization');
  });

  it('refuses both methods after close, without I/O', async () => {
    const { client, fetchImpl } = setupClient([]);
    await client.close();
    for (const call of [() => client.gateway.getStatus(), () => client.gateway.listBanks()]) {
      await expect(call()).rejects.toMatchObject({ code: 'sdk_client_closed' });
    }
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('logs metadata only, the token request included', async () => {
    const { logger, requests, responses } = recordingLogger();
    const { client } = setupClient([LOGIN, BANK_LIST], { logger });
    await client.gateway.listBanks();
    expect(requests).toStrictEqual([
      { method: 'POST', endpoint: 'POST /merchant/oauth2/token/', attempt: 1 },
      { method: 'GET', endpoint: 'GET /merchant/bankList/', attempt: 1 },
    ]);
    expect(responses.map(({ endpoint, httpStatus }) => [endpoint, httpStatus])).toEqual([
      ['POST /merchant/oauth2/token/', 200],
      ['GET /merchant/bankList/', 200],
    ]);
    expectNoSecretLeak({ requests, responses }, [
      PASSWORD,
      CONSUMER_SECRET,
      TOKEN.access_token,
      TOKEN.refresh_token,
    ]);
  });
});
