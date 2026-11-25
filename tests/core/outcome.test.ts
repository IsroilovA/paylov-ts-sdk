import { describe, expect, it } from 'vitest';

import { PaylovClient } from '../../src/client.js';
import {
  PaylovApiError,
  PaylovConnectionError,
  PaylovProtocolError,
  isPaylovOutcomeUnknown,
} from '../../src/core/errors.js';
import type { PaylovLogger } from '../../src/core/types.js';
import { captureAsync } from '../helpers/asserts.js';
import { createFakeFetch, type FakeResponseSpec } from '../helpers/fakeFetch.js';
import { patchedResponse, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL } from '../helpers/testHttp.js';
import { NETWORK_FAILURE } from './httpCases.js';

const LOGIN = wireResponse('auth/token.passwordSuccess.wire.json');
const REFRESHED = wireResponse('auth/token.refreshSuccess.wire.json');
const EXPIRED = wireResponse('envelope/bearer.expired.wire.json');
const SERVER_ERROR = wireResponse('envelope/serverError.wire.json');
const PROCESSING_ERROR = wireResponse('payments/pay.processingError.wire.json');
const GENERIC_FAILURE: FakeResponseSpec = {
  ...patchedResponse('envelope/generic.error.synthesized.json', ['error'], (error) => ({
    ...error,
    code: 'processing_error',
  })),
  status: 400,
};

const TOKEN_ENDPOINT = 'POST /merchant/oauth2/token/';
const PAY_ENDPOINT = 'POST /merchant/receipts/pay/';
const TRANSACTION_ID = '5eed0000-0000-4000-8000-000000000001';
const PAY = { transactionId: TRANSACTION_ID, cardId: 'card-1', userId: 'user-42' };

function setup(
  script: FakeResponseSpec[],
  logger?: PaylovLogger,
): { paylov: PaylovClient; fetchImpl: ReturnType<typeof createFakeFetch> } {
  const fetchImpl = createFakeFetch(script);
  const paylov = new PaylovClient({
    baseUrl: BASE_URL,
    consumerKey: 'EXAMPLE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL',
    consumerSecret: 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL',
    username: 'EXAMPLE-USERNAME-NOT-A-REAL-CREDENTIAL',
    password: 'EXAMPLE-PASSWORD-NOT-A-REAL-CREDENTIAL',
    fetch: fetchImpl,
    maxGetRetries: 0,
    ...(logger === undefined ? {} : { logger }),
  });
  return { paylov, fetchImpl };
}

describe('outcome of a failed call by the endpoint it requested', () => {
  it('stays known for a read answering HTTP 500 or a malformed body', async () => {
    const { paylov } = setup([LOGIN, SERVER_ERROR, { status: 200, body: { result: {} } }]);

    const failed = await captureAsync(paylov.transactions.get({ transactionId: TRANSACTION_ID }));
    const malformed = await captureAsync(paylov.cards.list({ userId: 'user-42' }));

    expect(failed).toMatchObject({ code: 'server_error', httpStatus: 500 });
    expect(malformed).toBeInstanceOf(PaylovProtocolError);
    expect([failed, malformed].map(isPaylovOutcomeUnknown)).toEqual([false, false]);
  });

  it('is unknown for a write answering HTTP 500, not for its generic failure code', async () => {
    const { paylov } = setup([LOGIN, SERVER_ERROR, GENERIC_FAILURE]);
    const receipt = { amountTiyin: 100_000, items: [] };

    const failed = await captureAsync(paylov.payments.create(receipt));
    const generic = await captureAsync(paylov.payments.create(receipt));

    expect(failed).toMatchObject({ code: 'server_error', httpStatus: 500 });
    expect(generic).toMatchObject({ code: 'processing_error', httpStatus: 400 });
    expect([failed, generic].map(isPaylovOutcomeUnknown)).toEqual([true, false]);
  });

  it('is unknown for a money endpoint answering a generic failure code', async () => {
    const { paylov } = setup([LOGIN, PROCESSING_ERROR]);

    const error = await captureAsync(paylov.payments.pay(PAY));

    expect(error).toMatchObject({ code: 'processing_error', endpoint: PAY_ENDPOINT });
    expect(isPaylovOutcomeUnknown(error)).toBe(true);
  });
});

describe('outcome when the operation was never sent', () => {
  it.each([
    ['disconnects', NETWORK_FAILURE, PaylovConnectionError, 'sdk_network_error'],
    [
      'answers a malformed 200',
      { status: 200, body: {} },
      PaylovProtocolError,
      'sdk_malformed_response',
    ],
    [
      'answers 503',
      { status: 503, rawBody: 'Service Unavailable' },
      PaylovProtocolError,
      'sdk_unexpected_status',
    ],
  ] as const)(
    'stays known for a pay whose password grant %s, naming the token endpoint',
    async (_label, grant, errorClass, code) => {
      const { paylov, fetchImpl } = setup([grant]);

      const error = await captureAsync(paylov.payments.pay(PAY));

      expect(error).toBeInstanceOf(errorClass);
      expect(error).toMatchObject({ code, endpoint: TOKEN_ENDPOINT });
      expect(isPaylovOutcomeUnknown(error)).toBe(false);
      expect(fetchImpl.calls.map((call) => new URL(call.url).pathname)).toEqual([
        '/merchant/oauth2/token/',
      ]);
    },
  );

  it('stays known when the refresh after a rejected token fails', async () => {
    const { paylov, fetchImpl } = setup([LOGIN, EXPIRED, SERVER_ERROR]);

    const error = await captureAsync(paylov.payments.pay(PAY));

    expect(error).toBeInstanceOf(PaylovApiError);
    expect(error).toMatchObject({ code: 'server_error', endpoint: TOKEN_ENDPOINT });
    expect(isPaylovOutcomeUnknown(error)).toBe(false);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it('stays known when an abort ends the call after a rejected token, before the replay', async () => {
    const controller = new AbortController();
    const { paylov, fetchImpl } = setup([LOGIN, EXPIRED, REFRESHED], {
      onResponse: (event) => {
        if (event.httpStatus === 401) controller.abort();
      },
    });

    const error = await captureAsync(paylov.payments.pay(PAY, { signal: controller.signal }));

    expect(error).toMatchObject({ code: 'sdk_aborted', endpoint: PAY_ENDPOINT, isSent: true });
    expect(isPaylovOutcomeUnknown(error)).toBe(false);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('is unknown when the replay itself disconnects', async () => {
    const { paylov, fetchImpl } = setup([LOGIN, EXPIRED, REFRESHED, NETWORK_FAILURE]);

    const error = await captureAsync(paylov.payments.pay(PAY));

    expect(error).toMatchObject({
      code: 'sdk_network_error',
      endpoint: PAY_ENDPOINT,
      isSent: true,
    });
    expect(isPaylovOutcomeUnknown(error)).toBe(true);
    expect(fetchImpl.calls).toHaveLength(4);
  });
});
