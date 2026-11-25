import {
  createServer,
  request as sendHttpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { describe, expect, it } from 'vitest';

import type { PaylovInputRule } from '../../src/core/errors.js';
import { PaylovWebhookReceiver } from '../../src/webhooks/receiver.js';
import type { TransactionCancelEvent, WebhookInput } from '../../src/webhooks/types.js';
import {
  basicAuthHeader,
  expectInputError,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import { loadFixture } from '../helpers/fixtures.js';

// Expectations come from docs/paylov/callbacks.md.
type Fixture = Record<string, unknown>;
const LOGIN = 'callback-user';
const PASSWORD = 'EXAMPLE-CALLBACK-PASSWORD-NOT-A-REAL-CREDENTIAL';
const AUTHORIZATION = basicAuthHeader(LOGIN, PASSWORD);
const WRONG_AUTHORIZATION = basicAuthHeader(LOGIN, 'wrong-password');
const CANCEL = loadFixture<Fixture>('webhooks/transactionCancel.notification.docs.json');
const CHECK = loadFixture<Fixture>('webhooks/transactionCheck.request.docs.json');

const receiver = new PaylovWebhookReceiver({ credentials: [{ login: LOGIN, password: PASSWORD }] });

/** Bodies here are untyped fixtures or malformed JavaScript values, which the receiver must take. */
function post(body: unknown, authorization = AUTHORIZATION): WebhookInput {
  return { method: 'POST', headers: { authorization }, body: body as WebhookInput['body'] };
}

function withParams(fixture: Fixture, patch: Fixture): Fixture {
  return { ...fixture, params: { ...recordOf(fixture['params']), ...patch } };
}

const CANCEL_EVENT: TransactionCancelEvent = {
  kind: 'transaction.cancel',
  transactionId: '9b3bd7be-9327-4608-b886-4353e49df05f',
  account: { order_id: '12345' },
  amountTiyin: 150000,
  cancelledAt: new Date('2025-12-31T06:24:03Z'),
};

describe('PaylovWebhookReceiver events', () => {
  it('decodes the documented transaction.cancel notification', () => {
    expect(receiver.receive(post(CANCEL))).toEqual({ ...CANCEL_EVENT, credentialIndex: 0 });
  });

  it('reads only the tiyin field, so a fractional or missing whole amount is accepted', () => {
    expect(receiver.receive(post(withParams(CANCEL, { amount: 1500.5 })))).toEqual({
      ...CANCEL_EVENT,
      credentialIndex: 0,
    });
    const cancelParams = { ...recordOf(CANCEL['params']) };
    delete cancelParams['amount'];
    expect(receiver.receive(post({ ...CANCEL, params: cancelParams })).kind).toBe(
      'transaction.cancel',
    );
  });

  it('accepts any UUID version as a transaction id', () => {
    const v7 = '01890a5d-ac96-774b-bcce-b302099a8057';
    expect(receiver.receive(post(withParams(CANCEL, { transaction_id: v7 })))).toMatchObject({
      transactionId: v7,
    });
  });

  it('accepts parsed JSON, strings, and bytes without exposing raw bodies', () => {
    for (const body of [
      CANCEL,
      JSON.stringify(CANCEL),
      Buffer.from(JSON.stringify(CANCEL), 'utf8'),
    ]) {
      expect(receiver.receive(post(body))).toEqual({ ...CANCEL_EVENT, credentialIndex: 0 });
    }
  });
});

describe('PaylovWebhookReceiver authentication', () => {
  it('rejects missing, malformed, duplicate, and wrong Basic credentials for every event', () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe]).toString('base64');
    const noColon = Buffer.from('missing-separator', 'utf8').toString('base64');
    const headerSets: Readonly<Record<string, string | readonly string[] | undefined>>[] = [
      {},
      { authorization: WRONG_AUTHORIZATION },
      { authorization: basicAuthHeader('wrong-login', PASSWORD) },
      { authorization: 'Bearer token' },
      { authorization: 'Basic not-base64' },
      { authorization: 'Basic abc' },
      { authorization: `Basic ${invalidUtf8}` },
      { authorization: `Basic ${noColon}` },
      { authorization: [AUTHORIZATION, AUTHORIZATION] },
    ];
    for (const headers of headerSets) {
      expect(receiver.receive({ ...post(CANCEL), headers })).toEqual({
        kind: 'invalid',
        reason: 'unauthorized',
      });
    }
  });

  it('rejects two differently cased Authorization keys in either order', () => {
    for (const headers of [
      { Authorization: AUTHORIZATION, authorization: WRONG_AUTHORIZATION },
      { authorization: WRONG_AUTHORIZATION, Authorization: AUTHORIZATION },
      { authorization: AUTHORIZATION, AUTHORIZATION: AUTHORIZATION },
    ]) {
      expect(receiver.receive({ ...post(CANCEL), headers })).toEqual({
        kind: 'invalid',
        reason: 'unauthorized',
      });
    }
  });

  it('accepts case-insensitive header names, scheme names, and single-value arrays', () => {
    const token = AUTHORIZATION.slice('Basic '.length);
    expect(
      receiver.receive({
        ...post(CANCEL),
        headers: { 'x-request-id': 'callback-request', AUTHORIZATION: `basic ${token}` },
      }).kind,
    ).toBe('transaction.cancel');
    expect(
      receiver.receive({ ...post(CANCEL), headers: { Authorization: [AUTHORIZATION] } }).kind,
    ).toBe('transaction.cancel');
  });

  it('rejects a repeated Authorization header read through Node headersDistinct', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no TCP address');
    /** What `receive` answers for a Node request carrying these Authorization headers. */
    const answer = async (authorization: readonly string[]): Promise<string> => {
      const received = new Promise<IncomingMessage>((resolve) => {
        server.once('request', (req: IncomingMessage, res: ServerResponse) => {
          res.end();
          resolve(req);
        });
      });
      const sent = sendHttpRequest({ port: address.port, host: '127.0.0.1', method: 'POST' });
      sent.setHeader('authorization', authorization);
      sent.end();
      const req = await received;
      await new Promise((resolve) => sent.on('response', resolve));
      return receiver.receive({ ...post(CANCEL), headers: req.headersDistinct }).kind;
    };
    try {
      expect(await answer([AUTHORIZATION, WRONG_AUTHORIZATION])).toBe('invalid');
      expect(await answer([AUTHORIZATION])).toBe('transaction.cancel');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reads Fetch Headers and accepts an undefined method as unsupported', () => {
    const headers = new Headers({ Authorization: AUTHORIZATION });
    expect(receiver.receive({ ...post(CANCEL), headers }).kind).toBe('transaction.cancel');
    const repeated = new Headers([
      ['authorization', AUTHORIZATION],
      ['authorization', AUTHORIZATION],
    ]);
    expect(receiver.receive({ ...post(CANCEL), headers: repeated })).toEqual({
      kind: 'invalid',
      reason: 'unauthorized',
    });
    expect(receiver.receive({ ...post(CANCEL), method: undefined, headers })).toEqual({
      kind: 'invalid',
      reason: 'unsupported_http_method',
    });
  });
});

describe('PaylovWebhookReceiver invalid input', () => {
  it('returns local invalid reasons without response bodies', () => {
    const cases: readonly [WebhookInput, string][] = [
      [{ ...post(CANCEL), method: 'GET' }, 'unsupported_http_method'],
      [{ ...post(CANCEL), headers: null as never }, 'unauthorized'],
      [{ ...post(CANCEL, 'Basic not-base64'), method: 'GET' }, 'unsupported_http_method'],
      [post('{', WRONG_AUTHORIZATION), 'unauthorized'],
      [post({ ...CANCEL, method: 'merchant.withdrawal' }, WRONG_AUTHORIZATION), 'unauthorized'],
      [post({ ...CANCEL, params: null }, WRONG_AUTHORIZATION), 'unauthorized'],
      [post('{'), 'malformed_body'],
      [post(new Uint8Array([0xff, 0xfe])), 'malformed_body'],
      [post(() => undefined), 'malformed_body'],
      [post([]), 'invalid_request'],
      [post({ unrelated: true }), 'invalid_request'],
      [post({ ...CANCEL, jsonrpc: '1.0' }), 'invalid_request'],
      [post({ ...CANCEL, method: 'merchant.withdrawal' }), 'unknown_method'],
      [post({ ...CANCEL, method: 'merchant.deposit' }), 'unknown_method'],
      [post(CHECK), 'unknown_method'],
      [
        post({
          ...CHECK,
          method: 'transaction.perform',
          params: {
            transaction_id: '9bd1a92b-5cce-47c8-a2df-99a20836ab9e',
            ...recordOf(CHECK['params']),
          },
        }),
        'unknown_method',
      ],
      [
        post(withParams(CANCEL, { amount_tiyin: 150000, amount_in_tiyin: undefined })),
        'invalid_params',
      ],
      [post({ ...CANCEL, params: null }), 'invalid_params'],
      [post({ ...CANCEL, params: [] }), 'invalid_params'],
      [post(withParams(CANCEL, { account: [] })), 'invalid_params'],
      [post(withParams(CANCEL, { transaction_id: 'not-a-uuid' })), 'invalid_params'],
      [post(withParams(CANCEL, { account: 'order' })), 'invalid_params'],
      [post(withParams(CANCEL, { amount_in_tiyin: '150000' })), 'invalid_params'],
      [post(withParams(CANCEL, { cancel_time: 1767162243.5 })), 'invalid_params'],
      [post(withParams(CANCEL, { cancel_time: -1 })), 'invalid_params'],
      [post(withParams(CANCEL, { status: 'payed' })), 'invalid_params'],
      [post(withParams(CANCEL, { status: undefined })), 'invalid_params'],
      [post({ ...CANCEL, id: 1 }), 'invalid_request'],
      [post({ ...CANCEL, id: null }), 'invalid_request'],
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
    const json = JSON.stringify(CANCEL);
    expect(receiver.receive(post(new TextEncoder().encode(json).buffer))).toEqual({
      ...CANCEL_EVENT,
      credentialIndex: 0,
    });
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
    const request = withParams(CANCEL, { account });
    const json = JSON.stringify(request);
    for (const body of [request, json, Buffer.from(json, 'utf8')]) {
      expect(receiver.receive(post(body))).toEqual({ kind: 'invalid', reason: 'invalid_params' });
    }
  });
});

describe('PaylovWebhookReceiver credential rotation', () => {
  const OLD = {
    login: 'callback-user-old',
    password: 'EXAMPLE-OLD-PASSWORD-NOT-A-REAL-CREDENTIAL',
  };
  const NEW = {
    login: 'callback-user-new',
    password: 'EXAMPLE-NEW-PASSWORD-NOT-A-REAL-CREDENTIAL',
  };
  const rotating = new PaylovWebhookReceiver({ credentials: [OLD, NEW] });

  it('accepts every configured pair and reports which one matched', () => {
    for (const [index, pair] of [OLD, NEW].entries()) {
      const outcome = rotating.receive(post(CANCEL, basicAuthHeader(pair.login, pair.password)));
      expect(outcome).toEqual({ ...CANCEL_EVENT, credentialIndex: index });
    }
  });

  it("rejects one pair's login with another pair's password", () => {
    for (const authorization of [
      basicAuthHeader(OLD.login, NEW.password),
      basicAuthHeader(NEW.login, OLD.password),
    ]) {
      expect(rotating.receive(post(CANCEL, authorization))).toEqual({
        kind: 'invalid',
        reason: 'unauthorized',
      });
    }
  });

  it('tells apart two passwords for the same login', () => {
    const samePassword = new PaylovWebhookReceiver({
      credentials: [OLD, { login: OLD.login, password: NEW.password }],
    });
    const receive = (password: string): unknown =>
      samePassword.receive(post(CANCEL, basicAuthHeader(OLD.login, password)));

    expect(receive(OLD.password)).toEqual({ ...CANCEL_EVENT, credentialIndex: 0 });
    expect(receive(NEW.password)).toEqual({ ...CANCEL_EVENT, credentialIndex: 1 });
    expect(receive(PASSWORD)).toEqual({ kind: 'invalid', reason: 'unauthorized' });
  });
});

describe('PaylovWebhookReceiver construction', () => {
  const pair = { login: LOGIN, password: PASSWORD };

  it.each<[string, unknown, string | undefined, PaylovInputRule]>([
    ['a missing config', undefined, undefined, 'type'],
    ['a missing credentials list', {}, 'credentials', 'required'],
    ['an empty credentials list', { credentials: [] }, 'credentials', 'required'],
    ['a credentials object instead of a list', { credentials: pair }, 'credentials', 'type'],
    [
      'an empty login',
      { credentials: [{ login: '', password: PASSWORD }] },
      'credentials[0].login',
      'required',
    ],
    [
      'a blank login',
      { credentials: [{ login: '  ', password: PASSWORD }] },
      'credentials[0].login',
      'required',
    ],
    [
      'an empty password',
      { credentials: [pair, { login: LOGIN, password: '' }] },
      'credentials[1].password',
      'required',
    ],
    [
      'a non-string password',
      { credentials: [{ login: LOGIN, password: 7 }] },
      'credentials[0].password',
      'type',
    ],
    [
      'a login with a colon, which Basic credentials can never carry',
      { credentials: [pair, { login: 'a:b', password: PASSWORD }] },
      'credentials[1].login',
      'format',
    ],
  ])('rejects %s', async (_case, config, field, rule) => {
    const error = await expectInputError(() => new PaylovWebhookReceiver(config as never), {
      code: 'sdk_config_error',
      field,
      rule,
    });
    expectNoSecretLeak(error, [PASSWORD]);
  });
});
