import { vi, type Mock } from 'vitest';

import type { HttpClientConfig } from '../../src/core/http.js';
import type { Decoder } from '../../src/core/decoding.js';
import type { AuthProvider, Endpoint, HttpClient } from '../../src/core/types.js';
import type { createFakeFetch, FakeResponseSpec } from '../helpers/fakeFetch.js';
import { fixtureResponse } from '../helpers/fixtures.js';
import { setupResource } from '../helpers/testHttp.js';

// Requests, responses and doubles shared by the transport suites.
export const PASSWORD = 'EXAMPLE-PASSWORD-NOT-A-REAL-CREDENTIAL';
export const PAN = ['860012', '341234', '1234'].join('');

export const SUCCESS = fixtureResponse('envelope/generic.success.synthesized.json');
export const SUCCESS_PAYLOAD = { transactionId: '9b370dde-dfe1-4365-be8a-d3581c9479ba' };
export const FUNDS_ERROR = fixtureResponse('envelope/generic.error.synthesized.json', {
  status: 400,
});
/** Hands the success payload back as the transport unwrapped it. */
export const rawPayload: Decoder<unknown> = (value) => value;

export const NETWORK_FAILURE: FakeResponseSpec = { throw: new TypeError('fetch failed') };

export const GET_STATUS: Endpoint = {
  method: 'GET',
  route: '/merchant/status/',
  shape: 'envelope',
  effect: 'read',
};
export const CREATE_RECEIPT: Endpoint = {
  method: 'POST',
  route: '/merchant/receipts/create/',
  shape: 'envelope',
  effect: 'write',
};
export const RECEIPT_BODY = { body: { amount: 1 } } as const;

export function client(
  script: FakeResponseSpec[],
  overrides: Omit<Partial<HttpClientConfig>, 'origin'> = {},
): { http: HttpClient; fetchImpl: ReturnType<typeof createFakeFetch> } {
  const { http, fetchImpl } = setupResource((transport) => transport, script, overrides);
  return { http, fetchImpl };
}

/** Hands out a new token generation on every call. */
export function rotatingAuth(): {
  auth: AuthProvider;
  authorize: Mock<AuthProvider['authorize']>;
  invalidate: Mock<AuthProvider['invalidate']>;
} {
  let issued = 0;
  const authorize = vi.fn<AuthProvider['authorize']>(() => {
    issued += 1;
    return Promise.resolve({ header: `Bearer token-${issued}`, generation: issued });
  });
  const invalidate = vi.fn<AuthProvider['invalidate']>();
  return { auth: { authorize, invalidate }, authorize, invalidate };
}
