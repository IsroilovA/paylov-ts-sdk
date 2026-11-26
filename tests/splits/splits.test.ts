import { describe, expect, it } from 'vitest';

import { createSplitsResource } from '../../src/splits/resource.js';
import {
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { fixtureResponse, loadWire, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

const TRANSACTION_ID = '5eed0000-0000-4000-8000-000000000001';
const PINFL = '88888888888888';
const RECIPIENT = '5eed0000-0000-4000-8000-000000000101';
const PLATFORM_RECIPIENT = '5eed0000-0000-4000-8000-000000000102';
const UNKNOWN_RECIPIENT = '5eed0000-0000-4000-8000-00000000dead';
const ITEM = {
  title: 'Delivery',
  priceTiyin: 850_000,
  count: 1,
  code: '10112001001000000',
  vatPercent: 12,
  packageCode: '1497773',
  pinfl: PINFL,
};

function setup(...script: FakeResponseSpec[]) {
  return setupResource(createSplitsResource, script);
}

describe('splits.create', () => {
  it('sends recipients with tiyin amounts and wire items', async () => {
    const { resource, fetchImpl } = setup(wireResponse('splits/create.success.wire.json'));

    const created = await resource.create({
      transactionId: TRANSACTION_ID,
      recipients: [
        { recipientId: 'platform', amountTiyin: 150_000 },
        {
          recipientId: 'abda5234-16aq-4896-90a2-b095ff557654',
          amountTiyin: 850_000,
          items: [ITEM],
        },
      ],
    });

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/splitPayment/`,
    });
    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({
      transactionId: TRANSACTION_ID,
      recipients: [
        { recipientId: 'platform', amount: 150_000 },
        {
          recipientId: 'abda5234-16aq-4896-90a2-b095ff557654',
          amount: 850_000,
          items: [
            {
              title: 'Delivery',
              price: 850_000,
              count: 1,
              code: '10112001001000000',
              vat_percent: 12,
              package_code: '1497773',
              pinfl: PINFL,
            },
          ],
        },
      ],
    });
    expect(created).toEqual({ transactionId: '5eed0000-0000-4000-8000-000000000201' });
  });

  it.each([
    [{ transactionId: 42 }, 'transactionId', 'type', 'sdk_invalid_input'],
    [
      { recipients: [{ recipientId: 'r', amountTiyin: 1.5 }] },
      'recipients[0].amountTiyin',
      'type',
      'sdk_invalid_amount',
    ],
    [
      { recipients: [{ amountTiyin: 100 }] },
      'recipients[0].recipientId',
      'required',
      'sdk_invalid_input',
    ],
  ] as const)('rejects %j before any request', async (override, field, rule, code) => {
    const { resource, fetchImpl } = setup();

    await expectInputError(
      resource.create({
        transactionId: TRANSACTION_ID,
        recipients: [{ recipientId: 'r', amountTiyin: 100 }],
        ...override,
      } as never),
      { code, field, rule },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('surfaces recipient_not_found without the recipient ids it carries', async () => {
    const { resource, requests, responses } = setup(
      wireResponse('splits/create.recipientNotFound.wire.json'),
    );

    const error = await expectApiError(
      resource.create({
        transactionId: TRANSACTION_ID,
        recipients: [{ recipientId: UNKNOWN_RECIPIENT, amountTiyin: 100_000, items: [ITEM] }],
      }),
      { code: 'recipient_not_found' },
    );
    expectNoSecretLeak(error, [UNKNOWN_RECIPIENT, PINFL]);
    expectNoSecretLeak([...requests, ...responses], [UNKNOWN_RECIPIENT, PINFL]);
  });
});

describe('splits.resendReceipt', () => {
  it('sends the recipients with their items and resendOFD, and reads the resend answer', async () => {
    const fixture = 'splits/resendReceipt.success.wire.json';
    const { resource, fetchImpl } = setup(wireResponse(fixture));
    const diagnostic = recordOf(recordOf(loadWire(fixture).body)['result'])['lastOfdError'];

    const resent = await resource.resendReceipt({
      transactionId: TRANSACTION_ID,
      recipients: [{ recipientId: RECIPIENT, amountTiyin: 850_000, items: [ITEM] }],
    });

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/splitPayment/`,
    });
    expect(recordOf(fetchImpl.calls[0]?.body)).toMatchObject({
      transactionId: TRANSACTION_ID,
      recipients: [{ recipientId: RECIPIENT, amount: 850_000, items: [{ price: 850_000 }] }],
      resendOFD: true,
    });
    expect(resent).toEqual({
      transactionId: '5eed0000-0000-4000-8000-000000000202',
      status: 'sent_to_ofd',
    });
    // The OFD's raw diagnostic for the previous submission never reaches the result.
    expect(diagnostic).toEqual(expect.any(String));
    expectNoSecretLeak(resent, [String(diagnostic)]);
  });

  it('sends a recipient without items beside one with items', async () => {
    const { resource, fetchImpl } = setup(wireResponse('splits/resendReceipt.success.wire.json'));

    await resource.resendReceipt({
      transactionId: TRANSACTION_ID,
      recipients: [
        { recipientId: PLATFORM_RECIPIENT, amountTiyin: 150_000 },
        { recipientId: RECIPIENT, amountTiyin: 850_000, items: [ITEM] },
      ],
    });

    expect(recordOf(fetchImpl.calls[0]?.body)['recipients']).toEqual([
      { recipientId: PLATFORM_RECIPIENT, amount: 150_000 },
      expect.objectContaining({
        recipientId: RECIPIENT,
        items: [expect.objectContaining({ price: 850_000 })],
      }),
    ]);
  });

  it.each([
    ['no recipient carries items', [{ recipientId: RECIPIENT, amountTiyin: 850_000 }]],
    ['the only items are empty', [{ recipientId: RECIPIENT, amountTiyin: 850_000, items: [] }]],
    ['there are no recipients', []],
  ])('rejects a resend where %s before any request', async (_case, recipients) => {
    const { resource, fetchImpl } = setup();

    await expectInputError(resource.resendReceipt({ transactionId: TRANSACTION_ID, recipients }), {
      code: 'sdk_invalid_input',
      field: 'recipients',
      rule: 'required',
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('still rejects an item without exactly one of tin or pinfl', async () => {
    const { resource, fetchImpl } = setup();
    const withBoth = { ...ITEM, tin: '123456789' };

    await expectInputError(
      resource.resendReceipt({
        transactionId: TRANSACTION_ID,
        recipients: [
          { recipientId: PLATFORM_RECIPIENT, amountTiyin: 150_000 },
          { recipientId: RECIPIENT, amountTiyin: 850_000, items: [withBoth] as never },
        ],
      }),
      { field: 'recipients[1].items[0]', rule: 'exclusive' },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('splits.get', () => {
  it('reads every share with tiyin amounts and Tashkent times, and no receipt as null', async () => {
    const { resource, fetchImpl } = setup(wireResponse('splits/get.twoShares.wire.json'));

    const split = await resource.get({ transactionId: TRANSACTION_ID });

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'GET',
      url: `${BASE_URL}/merchant/splitPayment/status/?transactionId=${TRANSACTION_ID}`,
    });
    const share = {
      recipientId: RECIPIENT,
      amountTiyin: 50_000,
      status: 'paid',
      createdAt: new Date('2026-11-25T06:56:19Z'),
    };
    expect(split).toEqual({ shares: [share, share], receipt: null });
  });

  it('reads each recipient its own share', async () => {
    const { resource } = setup(fixtureResponse('splits/get.twoRecipients.synthesized.json'));

    const split = await resource.get({ transactionId: TRANSACTION_ID });

    expect(split.shares).toEqual([
      {
        recipientId: RECIPIENT,
        amountTiyin: 30_000,
        status: 'paid',
        createdAt: new Date('2026-11-25T06:56:19Z'),
      },
      {
        recipientId: '5eed0000-0000-4000-8000-000000000102',
        amountTiyin: 70_000,
        status: 'cancelled',
        createdAt: new Date('2026-11-25T06:57:20Z'),
      },
    ]);
  });

  it('reads the fiscal receipt entry that follows the shares', async () => {
    const { resource } = setup(wireResponse('splits/get.saleReceipt.wire.json'));

    const split = await resource.get({ transactionId: TRANSACTION_ID });

    expect(split.shares).toHaveLength(1);
    expect(split.receipt).toEqual({
      receiptId: 4178,
      receiptUrl:
        'https://ofd.soliq.uz/epi?t=EZ000000000001&r=4178&c=20261125115642&s=100000000001',
      terminalId: 'EZ000000000001',
      fiscalSign: '100000000001',
      isRefund: false,
    });
  });

  it('throws split_not_found for a transaction without a split', async () => {
    const { resource } = setup(wireResponse('splits/get.splitNotFound.wire.json'));

    await expectApiError(resource.get({ transactionId: TRANSACTION_ID }), {
      code: 'split_not_found',
    });
  });

  it('throws transaction_not_found for an unknown transaction', async () => {
    const { resource } = setup(wireResponse('splits/get.transactionNotFound.wire.json'));

    await expectApiError(resource.get({ transactionId: TRANSACTION_ID }), {
      code: 'transaction_not_found',
    });
  });

  it('keeps unknown statuses open', async () => {
    const { resource } = setup({
      body: {
        result: [
          { recipientId: 'r', amount: 1, status: 'pending', createdAt: '2026-11-25 11:56:19' },
          { ofd: {} },
        ],
      },
    });

    const split = await resource.get({ transactionId: TRANSACTION_ID });

    expect(split.shares[0]?.status).toBe('pending');
  });

  it.each([
    [{ result: {} }, 'result'],
    [
      { result: [{ recipientId: 'r', amount: 1.5, status: 'paid', createdAt: '' }] },
      'result[0].amount',
    ],
    [
      { result: [{ recipientId: 'r', amount: 1, status: 'paid', createdAt: '2026-11-25' }] },
      'result[0].createdAt',
    ],
    [{ result: [{ ofd: { isRefund: false, receiptId: 1 } }] }, 'result[0].ofd.receiptUrl'],
  ])('reports %j as malformed at %s', async (body, path) => {
    const { resource } = setup({ body });

    await expectMalformed(resource.get({ transactionId: TRANSACTION_ID }), path);
  });
});
