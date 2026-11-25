import { describe, expect, expectTypeOf, it } from 'vitest';

import { readCall, send, type EndpointRequest } from '../../src/core/call.js';
import { asNonEmptyString, fieldOf } from '../../src/core/decoding.js';
import { PaylovProtocolError } from '../../src/core/errors.js';
import { capture, captureAsync } from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { loadFixture } from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

const CARD_ID = '5eed0000-0000-4000-8000-000000000001';
const SUCCESS: FakeResponseSpec = {
  body: loadFixture('envelope/generic.success.synthesized.json'),
};
const decodeTransactionId = fieldOf('transactionId', asNonEmptyString);

describe('readCall', () => {
  it('validates the parameters and the call options before any I/O', () => {
    const { signal } = new AbortController();
    const call = readCall({ cardId: CARD_ID }, { signal }, 'cards.get');
    expect(call.input.string('cardId')).toBe(CARD_ID);
    expect(call.signal).toBe(signal);
    expect(capture(() => readCall(null, undefined, 'cards.get'))).toMatchObject({
      code: 'sdk_invalid_input',
      message: 'cards.get expects an object',
    });
    expect(capture(() => readCall({}, { signal: 'soon' }, 'cards.get'))).toMatchObject({
      field: 'signal',
      rule: 'type',
    });
  });
});

const STATUS = {
  method: 'GET',
  route: '/merchant/status/',
  shape: 'envelope',
  effect: 'read',
} as const;
const CARD = {
  method: 'GET',
  route: '/merchant/userCard/{cardId}/',
  shape: 'envelope',
  effect: 'read',
} as const;
// Compile-time only: every route placeholder needs a path value.
expectTypeOf<EndpointRequest<typeof CARD>['path']>().toEqualTypeOf<
  Readonly<Record<'cardId', string>>
>();
expectTypeOf<EndpointRequest<typeof STATUS>['path']>().toEqualTypeOf<undefined>();

describe('send', () => {
  it('decodes an envelope under result', async () => {
    const { http, fetchImpl } = setupResource((transport) => transport, [SUCCESS, { body: {} }]);
    await expect(send(http, STATUS, {}, decodeTransactionId)).resolves.toBe(
      '9b370dde-dfe1-4365-be8a-d3581c9479ba',
    );
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/status/`);
    const error = await captureAsync(send(http, STATUS, {}, decodeTransactionId));
    expect(error).toBeInstanceOf(PaylovProtocolError);
    expect(error).toMatchObject({ path: 'result' });
  });

  it('fills the route and logs the template, never the identifier', async () => {
    const { http, fetchImpl, requests } = setupResource((transport) => transport, [SUCCESS]);
    await send(http, CARD, { path: { cardId: CARD_ID } }, decodeTransactionId);
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/userCard/${CARD_ID}/`);
    expect(requests[0]?.endpoint).toBe('GET /merchant/userCard/{cardId}/');
  });

  it('decodes the other shapes under body', async () => {
    const { http } = setupResource((transport) => transport, [{ body: { status: 1 } }]);
    const revoke = {
      method: 'POST',
      route: '/merchant/oauth2/revoke/',
      shape: 'flat',
      effect: 'write',
    } as const;
    const error = await captureAsync(send(http, revoke, {}, fieldOf('status', asNonEmptyString)));
    expect(error).toMatchObject({ code: 'sdk_malformed_response', path: 'body.status' });
  });
});
