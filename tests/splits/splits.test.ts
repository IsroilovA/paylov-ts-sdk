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
import { fixtureResponse } from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

const TRANSACTION_ID = '5eed0000-0000-4000-8000-000000000001';
const PINFL = '88888888888888';
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
    const { resource, fetchImpl } = setup(fixtureResponse('splits/create.success.docs.json'));

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
    expect(created).toEqual({ transactionId: '9b3bd7be-9327-4608-b886-4353e49df05f' });
  });

  it('forwards resendOfd as resendOFD and rejects a non-boolean', async () => {
    const { resource, fetchImpl } = setup(fixtureResponse('splits/create.success.docs.json'));
    const params = {
      transactionId: TRANSACTION_ID,
      recipients: [{ recipientId: 'platform', amountTiyin: 150_000 }],
    };

    await resource.create({ ...params, resendOfd: true });
    expect(recordOf(fetchImpl.calls[0]?.body)).toMatchObject({ resendOFD: true });

    await expectInputError(resource.create({ ...params, resendOfd: 'yes' } as never), {
      field: 'resendOfd',
      rule: 'type',
    });
    expect(fetchImpl.calls).toHaveLength(1);
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
      fixtureResponse('splits/create.recipientNotFound.docs.json', { status: 400 }),
    );

    const error = await expectApiError(
      resource.create({
        transactionId: TRANSACTION_ID,
        recipients: [{ recipientId: 'seller-42', amountTiyin: 100, items: [ITEM] }],
      }),
      { code: 'recipient_not_found' },
    );
    expectNoSecretLeak(error, ['<recipient_id>', 'seller-42', PINFL]);
    expectNoSecretLeak([...requests, ...responses], ['seller-42', PINFL]);
  });
});

describe('splits.get', () => {
  it('reads every recipient share with tiyin amounts and the raw creation time', async () => {
    const { resource, fetchImpl } = setup(fixtureResponse('splits/get.success.docs.json'));

    const shares = await resource.get({ transactionId: TRANSACTION_ID });

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'GET',
      url: `${BASE_URL}/merchant/splitPayment/status/?transactionId=${TRANSACTION_ID}`,
    });
    expect(shares).toEqual([
      {
        recipientId: 'ccda5111-66a0-4896-90a2-b095ff558129',
        amountTiyin: 100,
        status: 'paid',
        createdAtRaw: '2025-01-06 17:17:17',
      },
      {
        recipientId: 'ffddb832-4bd2-410c-a1d9-26dv9fefb111',
        amountTiyin: 100,
        status: 'paid',
        createdAtRaw: '2025-01-06 17:17:17',
      },
    ]);
  });

  it('keeps unknown statuses open', async () => {
    const { resource } = setup({
      body: {
        result: [
          { recipientId: 'r', amount: 1, status: 'pending', createdAt: '2025-01-06 17:17:17' },
        ],
      },
    });

    const [share] = await resource.get({ transactionId: TRANSACTION_ID });

    expect(share?.status).toBe('pending');
  });

  it.each([
    [{ result: {} }, 'result'],
    [
      { result: [{ recipientId: 'r', amount: 1.5, status: 'paid', createdAt: '' }] },
      'result[0].amount',
    ],
  ])('reports %j as malformed at %s', async (body, path) => {
    const { resource } = setup({ body });

    await expectMalformed(resource.get({ transactionId: TRANSACTION_ID }), path);
  });
});
