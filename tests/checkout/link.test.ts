/**
 * Links are checked against the code that consumes them: `runGuard` executes the checkout page's
 * recorded route guard (`Mce`), which turns a link payload into `internalCheckoutCreate`
 * mutation variables. The `spaParse.*.bundle.json` fixtures pin a probe's replay of that guard.
 */

import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { createCheckoutUrl, type CreateCheckoutUrlParams } from '../../src/checkout/link.js';
import { expectInputError, expectNoSecretLeak } from '../helpers/asserts.js';
import { loadFixture } from '../helpers/fixtures.js';

const HOST = 'https://my.paylov.uz/checkout/create/';
const MERCHANT_ID = '571c06fb-6c61-4ef7-8567-5511abaf12b5';

interface MutationVariables {
  merchantId: string;
  amount: number;
  account: Record<string, string>;
  currencyId: number;
  amountInTiyin: unknown;
  returnUrl: string;
  convertTo?: number;
}

interface SpaParseVector {
  decodedQuery: string;
  mutationVariables: MutationVariables;
}

const SPA_PARSE_CASES = ['variantSdk', 'edgeAccountUnreserved', 'edgeRawReturnUrl'] as const;

const spaParse = (name: (typeof SPA_PARSE_CASES)[number]): SpaParseVector =>
  loadFixture<SpaParseVector>(`checkout/spaParse.${name}.bundle.json`);

const GUARD_SOURCE = loadFixture<{ guard: string }>('checkout/routeGuard.bundle.json').guard;

type RouteGuard = (
  to: { params: { id: string } },
  from: undefined,
  next: (path?: string) => void,
) => Promise<void>;

interface GuardRun {
  variables: MutationVariables;
  /** First router navigation: `/checkout/{check.id}?return_url=...`. */
  path: string | undefined;
}

/** Runs the recorded guard on a link payload; `Lce` (the mutation call) is captured. */
async function runGuard(payload: string): Promise<GuardRun> {
  const state: { errors?: unknown } = {};
  let variables: MutationVariables | undefined;
  let path: string | undefined;
  const guard = runInNewContext(`(${GUARD_SOURCE})`, {
    atob,
    console: { log: () => undefined },
    Sce: () => state,
    Lce: (sent: MutationVariables) => {
      variables = structuredClone(sent);
      return Promise.resolve({ check: { id: 'CHECK' } });
    },
  }) as RouteGuard;
  await guard({ params: { id: payload } }, undefined, (next) => {
    path ??= next;
  });
  if (state.errors !== undefined) throw new Error('guard failed', { cause: state.errors });
  if (variables === undefined) throw new Error('guard did not call the mutation');
  return { variables, path };
}

const PARAMS: CreateCheckoutUrlParams = {
  merchantId: MERCHANT_ID,
  amount: { currency: 860, amountTiyin: 50_000 },
  account: { order_id: 'A-1001' },
  returnUrl: 'https://shop.example/checkout/return',
};

function payloadOf(url: string): string {
  expect(url.startsWith(HOST)).toBe(true);
  return url.slice(HOST.length);
}

async function parseLink(url: string): Promise<MutationVariables> {
  return (await runGuard(payloadOf(url))).variables;
}

describe('recorded route guard', () => {
  it.each(SPA_PARSE_CASES)('reproduces the probe replay for %s', async (name) => {
    const vector = spaParse(name);
    const { variables } = await runGuard(btoa(vector.decodedQuery));
    expect(variables).toEqual(vector.mutationVariables);
  });
});

describe('createCheckoutUrl — what the checkout page receives', () => {
  it('emits the recorded SDK variant query exactly', () => {
    const vector = spaParse('variantSdk');
    const url = createCheckoutUrl({
      merchantId: MERCHANT_ID,
      amount: { currency: 860, amountTiyin: 100_000 },
      account: { order_id: 'probe-checkout-ofd-3' },
      returnUrl: 'https://example.com/paylov/return?booking=probe&x=1',
    });
    expect(payloadOf(url)).toBe(btoa(vector.decodedQuery.replace('<MERCHANT_ID>', MERCHANT_ID)));
  });

  it('delivers merchant, tiyin amount and account unchanged', async () => {
    const url = createCheckoutUrl({
      ...PARAMS,
      account: { order_id: 'b2c4-UUID_like.v1', branch: '7' },
    });
    expect(await parseLink(url)).toEqual({
      merchantId: MERCHANT_ID,
      amount: 50_000,
      account: { order_id: 'b2c4-UUID_like.v1', branch: '7' },
      currencyId: 860,
      amountInTiyin: true,
      returnUrl: 'https%3A%2F%2Fshop.example%2Fcheckout%2Freturn',
    });
  });

  it('leaves a zero amount and an empty account for the page to judge', async () => {
    const url = createCheckoutUrl({
      ...PARAMS,
      amount: { currency: 860, amountTiyin: 0 },
      account: {},
    });
    expect(await parseLink(url)).toMatchObject({ amount: 0, account: {} });
  });

  it('keeps a return URL with a query intact through the single router decode', async () => {
    // A raw `=` would truncate it in the parser (edgeRawReturnUrl); encoding prevents that.
    const returnUrl = 'https://shop.example/return?booking=42&step=done#paid';
    const { variables, path } = await runGuard(
      payloadOf(createCheckoutUrl({ ...PARAMS, returnUrl })),
    );
    expect(decodeURIComponent(variables.returnUrl)).toBe(returnUrl);
    expect(path).toBe(`/checkout/CHECK?return_url=${encodeURIComponent(returnUrl)}`);
    expect(spaParse('edgeRawReturnUrl').mutationVariables.returnUrl).toBe('https://returnurl/?a');
  });

  it('sends a USD amount in cents with currency 840, and convert_to', async () => {
    const parsed = await parseLink(
      createCheckoutUrl({
        ...PARAMS,
        amount: { currency: 840, amountCents: 1_999 },
        convertTo: 860,
      }),
    );
    expect(parsed).toMatchObject({
      amount: 1_999,
      currencyId: 840,
      amountInTiyin: true,
      convertTo: 860,
    });
  });

  it('always states the currency and omits convert_to when absent', () => {
    const query = new URLSearchParams(atob(payloadOf(createCheckoutUrl(PARAMS))));
    expect(query.get('currency_id')).toBe('860');
    expect(query.get('amount_in_tiyin')).toBe('True');
    expect(query.has('convert_to')).toBe(false);
  });

  it('appends one standard-base64 path segment on the production host', () => {
    const payload = payloadOf(createCheckoutUrl(PARAMS));
    expect(payload).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(payload).not.toContain('/');
  });

  it('is deterministic and does not mutate its input', () => {
    const account = { order_id: 'A-1001' };
    const params = { ...PARAMS, account };
    expect(createCheckoutUrl(params)).toBe(createCheckoutUrl(params));
    expect(account).toEqual({ order_id: 'A-1001' });
  });
});

const INPUT = 'sdk_invalid_input';
const AMOUNT = 'sdk_invalid_amount';

function create(params: unknown): string {
  return createCheckoutUrl(params as CreateCheckoutUrlParams);
}

describe('createCheckoutUrl — checkout host', () => {
  it('defaults to the production checkout host', () => {
    expect(createCheckoutUrl(PARAMS).startsWith(HOST)).toBe(true);
  });

  it('builds the same payload under an overridden https origin, normalized', () => {
    const url = createCheckoutUrl({ ...PARAMS, baseUrl: ' https://Checkout.Example:8443/ ' });
    expect(url.startsWith('https://checkout.example:8443/checkout/create/')).toBe(true);
    expect(url.slice(url.lastIndexOf('/') + 1)).toBe(payloadOf(createCheckoutUrl(PARAMS)));
  });

  it.each([
    ['cleartext http', 'http://checkout.example'],
    ['a relative value', 'checkout.example'],
    ['a path', 'https://checkout.example/checkout/create/'],
    ['credentials', 'https://user:EXAMPLE-SECRET@checkout.example'],
    ['a query', 'https://checkout.example/?token=EXAMPLE-SECRET'],
    ['a fragment', 'https://checkout.example/#EXAMPLE-SECRET'],
  ])('rejects a baseUrl with %s without quoting it', async (_label, baseUrl) => {
    const error = await expectInputError(() => createCheckoutUrl({ ...PARAMS, baseUrl }), {
      code: INPUT,
      field: 'baseUrl',
      rule: 'format',
    });
    expect(error.message).not.toContain('EXAMPLE-SECRET');
  });

  it('rejects a non-string baseUrl', async () => {
    await expectInputError(
      () => create({ ...PARAMS, baseUrl: new URL('https://checkout.example') }),
      {
        code: INPUT,
        field: 'baseUrl',
        rule: 'type',
      },
    );
  });
});

describe('createCheckoutUrl — validation', () => {
  it.each([undefined, null, [], 'params', 42, true])('rejects the params %j', async (params) => {
    await expectInputError(() => create(params), { code: INPUT, field: undefined, rule: 'type' });
  });

  it.each([
    [{ currency: 860, amountTiyin: 50_000.5 }, AMOUNT, 'amount.amountTiyin', 'type'],
    [{ currency: 860, amountTiyin: -1 }, AMOUNT, 'amount.amountTiyin', 'type'],
    [{ currency: 860, amountTiyin: Number.NaN }, AMOUNT, 'amount.amountTiyin', 'type'],
    [
      { currency: 860, amountTiyin: Number.MAX_SAFE_INTEGER + 2 },
      AMOUNT,
      'amount.amountTiyin',
      'type',
    ],
    [{ currency: 840, amountTiyin: 100 }, AMOUNT, 'amount.amountCents', 'required'],
    [{ currency: 978, amountTiyin: 100 }, INPUT, 'amount.currency', 'format'],
    [{ currency: '860', amountTiyin: 100 }, INPUT, 'amount.currency', 'format'],
    [50_000, INPUT, 'amount', 'type'],
  ] as const)('rejects the amount %j as %s at %s (%s)', async (amount, code, field, rule) => {
    await expectInputError(() => create({ ...PARAMS, amount }), { code, field, rule });
  });

  it('rejects account values the parser would alter', async () => {
    // The recorded parser turns each of these into a different string (edgeAccountUnreserved).
    expect(spaParse('edgeAccountUnreserved').mutationVariables.account).toEqual({
      order_id: 'a+b',
      name: '%D0%98%D0%B2%D0%B0%D0%BD',
      ref: 'k%3Dv',
    });
    for (const value of ['a b', 'Иван', 'k=v', 'a&b', 'a+b', 'a~b', 'a*b', '50%', '']) {
      await expectInputError(() => create({ ...PARAMS, account: { order_id: value } }), {
        code: INPUT,
        field: 'account',
        rule: 'format',
      });
    }
  });

  it('rejects __proto__, which the page drops from the account', async () => {
    const { variables } = await runGuard(btoa('merchant_id=m&amount=1&account.__proto__=x'));
    expect(variables.account).toEqual({});
    await expectInputError(
      () => create({ ...PARAMS, account: Object.fromEntries([['__proto__', 'x']]) }),
      { code: INPUT, field: 'account', rule: 'format' },
    );
  });

  it.each([
    [{ 'order id': 'x' }, 'format'],
    [{ 'k=v': 'x' }, 'format'],
    [{ 'a&b': 'x' }, 'format'],
    [{ '': 'x' }, 'format'],
    [{ order_id: 12 }, 'type'],
    [{ order_id: true }, 'type'],
    [{ order_id: null }, 'type'],
    [[], 'type'],
  ] as const)('rejects the account %j (%s)', async (account, rule) => {
    await expectInputError(() => create({ ...PARAMS, account }), {
      code: INPUT,
      field: 'account',
      rule,
    });
  });

  it.each([
    [{ merchantId: '' }, 'merchantId', 'required'],
    [{ returnUrl: 'ftp://shop.example/return' }, 'returnUrl', 'format'],
    [{ returnUrl: 'not a url' }, 'returnUrl', 'format'],
    [{ returnUrl: '' }, 'returnUrl', 'required'],
    [{ convertTo: 978 }, 'convertTo', 'format'],
    [{ convertTo: Number.NaN }, 'convertTo', 'format'],
  ] as const)('rejects %j at %s (%s)', async (override, field, rule) => {
    await expectInputError(() => create({ ...PARAMS, ...override }), { code: INPUT, field, rule });
  });

  it('names the field but never the rejected value', async () => {
    const pan = ['860012', '341234', '1234'].join('');
    const valueError = await expectInputError(
      () => createCheckoutUrl({ ...PARAMS, account: { customer: `pan ${pan}` } }),
      { code: INPUT, field: 'account', rule: 'format' },
    );
    const keyError = await expectInputError(
      () => createCheckoutUrl({ ...PARAMS, account: { [`pan ${pan}`]: 'x' } }),
      { code: INPUT, field: 'account', rule: 'format' },
    );
    const urlError = await expectInputError(
      () => createCheckoutUrl({ ...PARAMS, returnUrl: 'ftp://shop.example/?token=SECRET' }),
      { code: INPUT, field: 'returnUrl', rule: 'format' },
    );
    expectNoSecretLeak(valueError, [pan]);
    expectNoSecretLeak(keyError, [pan]);
    expectNoSecretLeak(urlError, ['SECRET']);
  });
});
