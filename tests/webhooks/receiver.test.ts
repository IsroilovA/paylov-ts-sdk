import { describe, expect, it } from 'vitest';

import { PaylovInputError } from '../../src/core/errors.js';
import { PaylovWebhookReceiver } from '../../src/webhooks/receiver.js';
import type { TransactionCheckEvent, WebhookInput } from '../../src/webhooks/types.js';
import { basicAuthHeader, capture, expectNoSecretLeak, recordOf } from '../helpers/asserts.js';
import { loadFixture } from '../helpers/fixtures.js';

// Expectations come from docs/paylov/callbacks.md.
type Fixture = Record<string, unknown>;
const LOGIN = 'callback-user';
const PASSWORD = 'EXAMPLE-CALLBACK-PASSWORD-NOT-A-REAL-CREDENTIAL';
const AUTHORIZATION = basicAuthHeader(LOGIN, PASSWORD);
const CHECK = loadFixture<Fixture>('webhooks/transactionCheck.request.docs.json');
const PERFORM = loadFixture<Fixture>('webhooks/transactionPerform.request.docs.json');
const CANCEL = loadFixture<Fixture>('webhooks/transactionCancel.notification.docs.json');
const DEPOSIT = loadFixture<Fixture>('webhooks/merchantDeposit.notification.docs.json');
const CARD_BIND = loadFixture<Fixture>('webhooks/cardBind.notification.docs.json');

const receiver = new PaylovWebhookReceiver({ login: LOGIN, password: PASSWORD });

/** Bodies here are untyped fixtures or malformed JavaScript values, which the receiver must take. */
function post(body: unknown, authorization = AUTHORIZATION): WebhookInput {
  return { method: 'POST', headers: { authorization }, body: body as WebhookInput['body'] };
}

function withParams(fixture: Fixture, patch: Fixture): Fixture {
  return { ...fixture, params: { ...recordOf(fixture['params']), ...patch } };
}

const CHECK_EVENT: TransactionCheckEvent = {
  kind: 'transaction.check',
  id: 1234567,
  account: { order_id: 12 },
  amount: { currency: 860, amountTiyin: 50000 },
};

describe('PaylovWebhookReceiver events', () => {
  it('decodes the documented transaction.check request', () => {
    expect(receiver.receive(post(CHECK))).toEqual(CHECK_EVENT);
  });

  it('decodes the documented transaction.perform request', () => {
    expect(receiver.receive(post(PERFORM))).toEqual({
      kind: 'transaction.perform',
      id: 1234567,
      transactionId: '9bd1a92b-5cce-47c8-a2df-99a20836ab9e',
      account: { order_id: 12 },
      amount: { currency: 860, amountTiyin: 50000 },
    });
  });

  it('reads a USD check amount as cents', () => {
    expect(
      receiver.receive(post(withParams(CHECK, { currency: 840, amount_tiyin: 1999 }))),
    ).toEqual({
      ...CHECK_EVENT,
      amount: { currency: 840, amountCents: 1999 },
    });
  });

  it('decodes the documented transaction.cancel notification', () => {
    expect(receiver.receive(post(CANCEL))).toEqual({
      kind: 'transaction.cancel',
      transactionId: '9b3bd7be-9327-4608-b886-4353e49df05f',
      account: { order_id: '12345' },
      amountTiyin: 150000,
      cancelledAt: new Date('2025-12-31T06:24:03Z'),
    });
  });

  it('decodes the documented merchant.deposit notification', () => {
    expect(receiver.receive(post(DEPOSIT))).toEqual({
      kind: 'merchant.deposit',
      depositId: '6f1c2b7e-3d4a-5b8c-9e0f-1a2b3c4d5e6f',
      merchantId: '125',
      source: 'a2c',
      amountTiyin: 10000000,
      createdAt: new Date('2025-12-31T06:24:03Z'),
    });
  });

  it('passes through an unknown deposit channel as an open value', () => {
    expect(receiver.receive(post(withParams(DEPOSIT, { type: 'uzum' })))).toMatchObject({
      kind: 'merchant.deposit',
      source: 'uzum',
    });
  });

  it('decodes the documented card-bind notification, surfacing only the card id', () => {
    const outcome = receiver.receive(post(CARD_BIND));
    expect(outcome).toEqual({
      kind: 'card.bind',
      token: 'pR3x...kLq9',
      userId: 'partner-user-10234',
      status: 'confirmed',
      cardId: '5eed0000-0000-4000-8000-0000000000c1',
    });
    expect(JSON.stringify(outcome)).not.toContain('860012');
  });

  it('reads only the tiyin field, so a fractional or missing whole amount is accepted', () => {
    expect(receiver.receive(post(withParams(CHECK, { amount: 500.5 })))).toEqual(CHECK_EVENT);
    const cancelParams = { ...recordOf(CANCEL['params']) };
    delete cancelParams['amount'];
    expect(receiver.receive(post({ ...CANCEL, params: cancelParams })).kind).toBe(
      'transaction.cancel',
    );
  });

  it('accepts any UUID version as a transaction id', () => {
    const v7 = '01890a5d-ac96-774b-bcce-b302099a8057';
    expect(receiver.receive(post(withParams(PERFORM, { transaction_id: v7 })))).toMatchObject({
      transactionId: v7,
    });
    expect(receiver.receive(post(withParams(CANCEL, { transaction_id: v7 })))).toMatchObject({
      transactionId: v7,
    });
  });

  it('passes through an unknown card-bind status as an open value', () => {
    expect(receiver.receive(post({ ...CARD_BIND, status: 'expired' }))).toMatchObject({
      kind: 'card.bind',
      status: 'expired',
    });
  });

  it('accepts parsed JSON, strings, bytes, and string JSON-RPC ids without exposing raw bodies', () => {
    const request = { ...CHECK, id: 'merchant-correlation-id' };
    for (const body of [
      request,
      JSON.stringify(request),
      Buffer.from(JSON.stringify(request), 'utf8'),
    ]) {
      const outcome = recordOf(receiver.receive(post(body)));
      expect(outcome['id']).toBe('merchant-correlation-id');
      expect(outcome['raw']).toBeUndefined();
      expect(outcome['amount']).toEqual({ currency: 860, amountTiyin: 50000 });
    }
  });
});

describe('PaylovWebhookReceiver authentication', () => {
  it('rejects missing, malformed, duplicate, and wrong Basic credentials for every event', () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe]).toString('base64');
    const noColon = Buffer.from('missing-separator', 'utf8').toString('base64');
    const headerSets: Readonly<Record<string, string | readonly string[] | undefined>>[] = [
      {},
      { authorization: basicAuthHeader(LOGIN, 'wrong-password') },
      { authorization: basicAuthHeader('wrong-login', PASSWORD) },
      { authorization: 'Bearer token' },
      { authorization: 'Basic not-base64' },
      { authorization: 'Basic abc' },
      { authorization: `Basic ${invalidUtf8}` },
      { authorization: `Basic ${noColon}` },
      { authorization: [AUTHORIZATION, AUTHORIZATION] },
    ];
    for (const body of [CHECK, CANCEL, CARD_BIND]) {
      for (const headers of headerSets) {
        expect(receiver.receive({ ...post(body), headers })).toEqual({
          kind: 'invalid',
          reason: 'unauthorized',
        });
      }
    }
  });

  it('accepts case-insensitive header names, scheme names, and single-value arrays', () => {
    const token = AUTHORIZATION.slice('Basic '.length);
    expect(
      receiver.receive({
        ...post(CHECK),
        headers: { 'x-request-id': 'callback-request', AUTHORIZATION: `basic ${token}` },
      }).kind,
    ).toBe('transaction.check');
    expect(
      receiver.receive({ ...post(CHECK), headers: { Authorization: [AUTHORIZATION] } }).kind,
    ).toBe('transaction.check');
  });

  it('reads Fetch Headers and accepts an undefined method as unsupported', () => {
    const headers = new Headers({ Authorization: AUTHORIZATION });
    expect(receiver.receive({ ...post(CHECK), headers }).kind).toBe('transaction.check');
    const repeated = new Headers([
      ['authorization', AUTHORIZATION],
      ['authorization', AUTHORIZATION],
    ]);
    expect(receiver.receive({ ...post(CHECK), headers: repeated })).toEqual({
      kind: 'invalid',
      reason: 'unauthorized',
    });
    expect(receiver.receive({ ...post(CHECK), method: undefined, headers })).toEqual({
      kind: 'invalid',
      reason: 'unsupported_http_method',
    });
  });
});

describe('PaylovWebhookReceiver invalid input', () => {
  it('returns local invalid reasons without response bodies', () => {
    const cases: readonly [WebhookInput, string][] = [
      [{ ...post(CHECK), method: 'GET' }, 'unsupported_http_method'],
      [{ ...post(CHECK), headers: null as never }, 'unauthorized'],
      [post('{'), 'malformed_body'],
      [post(new Uint8Array([0xff, 0xfe])), 'malformed_body'],
      [post(() => undefined), 'malformed_body'],
      [post([]), 'invalid_request'],
      [post({ unrelated: true }), 'invalid_request'],
      [post({ ...CHECK, jsonrpc: '1.0' }), 'invalid_request'],
      [post({ ...CHECK, id: null }), 'invalid_request'],
      [post({ ...PERFORM, id: Number.NaN }), 'invalid_request'],
      [post({ ...CHECK, method: 'merchant.withdrawal' }), 'unknown_method'],
      [post({ ...DEPOSIT, params: null }), 'invalid_params'],
      [post(withParams(DEPOSIT, { id: 'not-a-uuid' })), 'invalid_params'],
      [post(withParams(DEPOSIT, { merchant: 125 })), 'invalid_params'],
      [post(withParams(DEPOSIT, { merchant: '' })), 'invalid_params'],
      [post(withParams(DEPOSIT, { type: '' })), 'invalid_params'],
      [post(withParams(DEPOSIT, { amount_in_tiyin: 100.5 })), 'invalid_params'],
      [
        post(withParams(DEPOSIT, { amount_tiyin: 10000000, amount_in_tiyin: undefined })),
        'invalid_params',
      ],
      [post(withParams(DEPOSIT, { create_time: '1767162243' })), 'invalid_params'],
      [
        post(withParams(CANCEL, { amount_tiyin: 150000, amount_in_tiyin: undefined })),
        'invalid_params',
      ],
      [
        post(withParams(PERFORM, { amount_in_tiyin: 50000, amount_tiyin: undefined })),
        'invalid_params',
      ],
      [post({ ...CHECK, params: null }), 'invalid_params'],
      [post({ ...CANCEL, params: [] }), 'invalid_params'],
      [post(withParams(CHECK, { account: [] })), 'invalid_params'],
      [post(withParams(CHECK, { amount_tiyin: 1.5 })), 'invalid_params'],
      [post(withParams(CHECK, { amount_tiyin: -1 })), 'invalid_params'],
      [post(withParams(CHECK, { currency: 978 })), 'invalid_params'],
      [post(withParams(PERFORM, { transaction_id: 'not-a-uuid' })), 'invalid_params'],
      [post(withParams(CANCEL, { transaction_id: 'not-a-uuid' })), 'invalid_params'],
      [post(withParams(CANCEL, { account: 'order' })), 'invalid_params'],
      [post(withParams(CANCEL, { amount_in_tiyin: '150000' })), 'invalid_params'],
      [post(withParams(CANCEL, { cancel_time: 1767162243.5 })), 'invalid_params'],
      [post(withParams(CANCEL, { cancel_time: -1 })), 'invalid_params'],
      [post({ ...CARD_BIND, token: '' }), 'invalid_params'],
      [post({ ...CARD_BIND, userId: 10234 }), 'invalid_params'],
      [post({ ...CARD_BIND, status: undefined }), 'invalid_params'],
      [post({ ...CARD_BIND, card: undefined }), 'invalid_params'],
      [post({ ...CARD_BIND, card: { cardId: 'not-a-uuid' } }), 'invalid_params'],
    ];
    for (const [input, reason] of cases) {
      expect(receiver.receive(input)).toEqual({ kind: 'invalid', reason });
    }
  });

  it('classifies a non-object input as invalid_request and an unserializable body as malformed', () => {
    expect(receiver.receive(undefined as never)).toEqual({
      kind: 'invalid',
      reason: 'invalid_request',
    });
    const throwingBody = {
      toJSON() {
        throw new Error('WEBHOOK-INPUT-SECRET');
      },
    };
    expect(receiver.receive(post(throwingBody))).toEqual({
      kind: 'invalid',
      reason: 'malformed_body',
    });
  });

  it('reads an ArrayBuffer body as bytes and answers an unread body object malformed_body', () => {
    const json = JSON.stringify(CHECK);
    expect(receiver.receive(post(new TextEncoder().encode(json).buffer))).toEqual(CHECK_EVENT);
    // A Fetch Request's body is a stream, which would re-serialize as `{}`.
    const request = new Request('https://merchant.example/paylov', {
      method: 'POST',
      headers: { authorization: AUTHORIZATION },
      body: json,
    });
    const unread = [request.body, new Blob([json]), new Map([['jsonrpc', '2.0']]), new Date(0)];
    for (const body of unread) {
      expect(receiver.receive(post(body))).toEqual({ kind: 'invalid', reason: 'malformed_body' });
    }
  });

  it('rejects an account nested too deep to copy as invalid_params in every body form', () => {
    let account: Record<string, unknown> = { order_id: 'A-1001' };
    for (let depth = 0; depth < 2_000; depth += 1) account = { x: account };
    const request = withParams(CHECK, { account });
    const json = JSON.stringify(request);
    for (const body of [request, json, Buffer.from(json, 'utf8')]) {
      expect(receiver.receive(post(body))).toEqual({ kind: 'invalid', reason: 'invalid_params' });
    }
  });
});

describe('PaylovWebhookReceiver construction', () => {
  it('rejects a missing config and a blank or non-string login or password by field', () => {
    const cases: readonly [unknown, string | undefined][] = [
      [undefined, undefined],
      [{ login: '', password: PASSWORD }, 'login'],
      [{ login: '  ', password: PASSWORD }, 'login'],
      [{ login: LOGIN, password: '' }, 'password'],
      [{ login: LOGIN, password: 7 }, 'password'],
    ];
    for (const [config, field] of cases) {
      const error = capture(() => new PaylovWebhookReceiver(config as never));
      expect(error).toBeInstanceOf(PaylovInputError);
      expect(error).toMatchObject({ code: 'sdk_config_error', field });
      expectNoSecretLeak(error, [PASSWORD]);
    }
  });

  it('rejects a login with a colon, which Basic credentials can never carry', () => {
    const error = capture(() => new PaylovWebhookReceiver({ login: 'a:b', password: PASSWORD }));
    expect(error).toBeInstanceOf(PaylovInputError);
    expect(error).toMatchObject({ code: 'sdk_config_error', field: 'login', rule: 'format' });
  });
});
