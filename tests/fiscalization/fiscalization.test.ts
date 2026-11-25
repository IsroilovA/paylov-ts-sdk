import { describe, expect, it } from 'vitest';

import { createFiscalizationResource } from '../../src/fiscalization/resource.js';
import {
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { fixtureResponse, patchedResponse, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

const TRANSACTION_ID = '5eed0000-0000-4000-8000-000000000001';
const ITEM_PINFL = '88888888888888';
const PERSON_PINFL = '99999999999999';
const ITEM = {
  title: 'Consultation',
  priceTiyin: 25_000_000,
  count: 1,
  code: '10112001001000000',
  vatPercent: 12,
  packageCode: '1497773',
};
const WIRE_ITEM = {
  title: 'Consultation',
  price: 25_000_000,
  count: 1,
  code: '10112001001000000',
  vat_percent: 12,
  package_code: '1497773',
};

/** A card-payment registration with one item fiscalized under a TIN. */
const REGISTER = { transactionId: TRANSACTION_ID, items: [{ ...ITEM, tin: '123456789' }] };

function setup(...script: FakeResponseSpec[]) {
  return setupResource(createFiscalizationResource, script);
}

describe('fiscalization.registerReceipt', () => {
  it('registers a card payment by transactionId and decodes result.ofd', async () => {
    const { resource, fetchImpl } = setup(
      wireResponse('fiscalization/registerReceipt.success.wire.json'),
    );

    const receipt = await resource.registerReceipt(REGISTER);

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/fiscalization/register/`,
      body: { transactionId: TRANSACTION_ID, items: [{ ...WIRE_ITEM, tin: '123456789' }] },
    });
    expect(receipt).toEqual({
      receiptId: 4171,
      receiptUrl:
        'https://ofd.soliq.uz/epi?t=EZ000000000001&r=4171&c=20261125112445&s=100000000001',
      terminalId: 'EZ000000000001',
      fiscalSign: '100000000001',
    });
  });

  it('reports an OFD rejection as a settled failure without quoting the OFD answer', async () => {
    const { resource, requests, responses } = setup(
      wireResponse('fiscalization/registerReceipt.ofdError.wire.json'),
    );

    const error = await expectApiError(resource.registerReceipt(REGISTER), { code: 'ofd_error' });

    expect(error.isOutcomeUnknown).toBe(false);
    const answer = ['invalid package code', 'Ofd error.'];
    expectNoSecretLeak(error, answer);
    expectNoSecretLeak([...requests, ...responses], answer);
  });

  it('sends an item fiscalized under a PINFL', async () => {
    const { resource, fetchImpl } = setup(
      fixtureResponse('fiscalization/registerReceipt.success.docs.json'),
    );

    await resource.registerReceipt({
      transactionId: TRANSACTION_ID,
      items: [{ ...ITEM, pinfl: ITEM_PINFL }],
    });

    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({
      transactionId: TRANSACTION_ID,
      items: [{ ...WIRE_ITEM, pinfl: ITEM_PINFL }],
    });
  });

  it('requires the transactionId before any request', async () => {
    const { resource, fetchImpl } = setup();

    await expectInputError(
      resource.registerReceipt({ items: [{ ...ITEM, tin: '123456789' }] } as never),
      { field: 'transactionId', rule: 'required' },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('reports a result without receiptId as malformed', async () => {
    const { resource } = setup(
      fixtureResponse('fiscalization/registerReceipt.missingReceiptId.synthesized.json'),
    );

    await expectMalformed(resource.registerReceipt(REGISTER), 'result.ofd.receiptId');
  });

  it('exposes nested gateway validation as flattened wire field paths', async () => {
    const { resource } = setup(
      wireResponse('fiscalization/registerReceipt.nestedValidation.wire.json'),
    );

    await expectApiError(resource.registerReceipt(REGISTER), {
      code: 'validation_error',
      fields: [
        'items.0.title',
        'items.0.price',
        'items.0.count',
        'items.0.code',
        'items.0.vat_percent',
        'items.0.package_code',
      ],
    });
  });

  it('keeps PINFLs and echoed tax ids out of errors and logger events', async () => {
    const { resource, requests, responses } = setup(
      fixtureResponse('fiscalization/registerReceipt.commitentNotActive.docs.json', {
        status: 400,
      }),
    );

    const error = await expectApiError(
      resource.registerReceipt({
        transactionId: TRANSACTION_ID,
        items: [{ ...ITEM, pinfl: ITEM_PINFL }],
      }),
      { code: 'ofd_commitent_or_subcommission_not_active' },
    );
    const secrets = [ITEM_PINFL, '123456789'];
    expectNoSecretLeak(error, secrets);
    expectNoSecretLeak([...requests, ...responses], secrets);
  });
});

describe('fiscalization.getReceipt', () => {
  it('reads a refund receipt by transactionId with the isRefund filter', async () => {
    const { resource, fetchImpl } = setup(
      wireResponse('fiscalization/getReceipt.refund.wire.json'),
    );

    const receipt = await resource.getReceipt({ transactionId: TRANSACTION_ID, isRefund: true });

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'GET',
      url: `${BASE_URL}/merchant/fiscalization/status/?transactionId=${TRANSACTION_ID}&refunded=true`,
    });
    expect(receipt).toEqual({
      receiptId: 4173,
      receiptUrl:
        'https://ofd.soliq.uz/epi?t=EZ000000000001&r=4173&c=20261125112828&s=100000000003',
      terminalId: 'EZ000000000001',
      fiscalSign: '100000000003',
      isRefund: true,
    });
  });

  it('decodes the documented sale receipt', async () => {
    const { resource } = setup(fixtureResponse('fiscalization/getReceipt.success.docs.json'));

    const receipt = await resource.getReceipt({ transactionId: TRANSACTION_ID, isRefund: false });

    expect(receipt).toEqual({
      receiptId: 173723,
      receiptUrl: 'https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001',
      terminalId: 'EP000000000378',
      fiscalSign: '947030008479',
      isRefund: false,
    });
  });

  it('returns null for the live no-receipt answer', async () => {
    const { resource } = setup(wireResponse('fiscalization/getReceipt.noReceipt.wire.json'));

    expect(await resource.getReceipt({ transactionId: TRANSACTION_ID })).toBeNull();
  });

  it('throws for an unknown transactionId instead of null', async () => {
    const { resource } = setup(
      fixtureResponse('fiscalization/getReceipt.transactionNotFound.synthesized.json', {
        status: 400,
      }),
    );

    await expectApiError(resource.getReceipt({ transactionId: TRANSACTION_ID }), {
      code: 'transaction_not_found',
    });
  });

  it('requires isRefund on a found receipt', async () => {
    const { resource } = setup(
      patchedResponse('fiscalization/getReceipt.success.docs.json', ['result'], (result) => ({
        ...result,
        isRefund: null,
      })),
    );

    await expectMalformed(
      resource.getReceipt({ transactionId: TRANSACTION_ID }),
      'result.isRefund',
    );
  });

  it('requires the transactionId before any request', async () => {
    const { resource, fetchImpl } = setup();

    await expectInputError(resource.getReceipt({ isRefund: true } as never), {
      field: 'transactionId',
      rule: 'required',
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('fiscalization.refundReceipt', () => {
  it('returns the new refund receipt and the reversed sale', async () => {
    const { resource, fetchImpl } = setup(
      fixtureResponse('fiscalization/refundReceipt.success.docs.json'),
    );

    const refunded = await resource.refundReceipt({ receiptId: 184595 });

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/fiscalization/refund/`,
      body: { receiptId: 184595 },
    });
    expect(refunded.refund.receiptId).toBe(184636);
    expect(refunded.sale).toEqual({
      receiptId: 184595,
      receiptUrl: 'https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001',
      terminalId: 'EP000000000378',
      fiscalSign: '290464420473',
    });
  });

  it('requires the sale receipt in the result', async () => {
    const { resource } = setup(
      fixtureResponse('fiscalization/refundReceipt.missingSale.synthesized.json'),
    );

    await expectMalformed(resource.refundReceipt({ receiptId: 184595 }), 'result.sale');
  });
});

describe('fiscalization.checkActivityType', () => {
  it.each([
    ['individual_entrepreneur', 1, 'negative', { isConfirmed: false, activityNames: [] }],
    ['self_employed', 2, 'selfEmployed', { isConfirmed: true, activityNames: [] }],
    [
      'high_income',
      3,
      'highIncome',
      {
        isConfirmed: true,
        activityNames: ['Lorem Ipsum is simply dummy text'],
      },
    ],
  ] as const)(
    'sends %s as %i and decodes the %s answer',
    async (activityType, wire, fixture, expected) => {
      const { resource, fetchImpl } = setup(
        fixtureResponse(`fiscalization/checkActivityType.${fixture}.docs.json`),
      );

      const check = await resource.checkActivityType({ pinfl: PERSON_PINFL, activityType });

      expect(fetchImpl.calls[0]).toMatchObject({
        method: 'POST',
        url: `${BASE_URL}/merchant/fiscalization/activity-types/`,
        body: { pinfl: PERSON_PINFL, activityType: wire },
      });
      expect(check).toEqual(expected);
    },
  );

  it.each([
    ['self_employed', 'selfEmployedNegative'],
    ['high_income', 'highIncomeNoRecord'],
  ] as const)('reads the live negative %s answer as unconfirmed', async (activityType, fixture) => {
    const { resource } = setup(
      wireResponse(`fiscalization/checkActivityType.${fixture}.wire.json`),
    );

    const check = await resource.checkActivityType({ pinfl: PERSON_PINFL, activityType });

    expect(check).toEqual({ isConfirmed: false, activityNames: [] });
  });

  it('reads a high-income check that ran with status false as unconfirmed', async () => {
    const { resource } = setup({
      body: { result: { success: true, data: { status: false, activityNames: [] } } },
    });

    const check = await resource.checkActivityType({
      pinfl: PERSON_PINFL,
      activityType: 'high_income',
    });

    expect(check).toEqual({ isConfirmed: false, activityNames: [] });
  });

  it('rejects data that is neither null, a number nor the income object', async () => {
    const { resource } = setup({ body: { result: { success: true, data: 'yes' } } });

    await expectMalformed(
      resource.checkActivityType({ pinfl: PERSON_PINFL, activityType: 'self_employed' }),
      'result.data',
    );
  });

  it('rejects a wire activity type before any request, without quoting the PINFL', async () => {
    const { resource, fetchImpl } = setup();

    const error = await expectInputError(
      resource.checkActivityType({ pinfl: PERSON_PINFL, activityType: 1 } as never),
      { field: 'activityType', rule: 'format' },
    );
    expectNoSecretLeak(error, [PERSON_PINFL]);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('keeps the PINFL out of gateway errors and logger events', async () => {
    const { resource, requests, responses } = setup(
      wireResponse('fiscalization/checkActivityType.permissionDenied.wire.json'),
    );

    const error = await expectApiError(
      resource.checkActivityType({ pinfl: PERSON_PINFL, activityType: 'high_income' }),
      { code: 'permission_denied' },
    );
    expectNoSecretLeak(error, [PERSON_PINFL]);
    expectNoSecretLeak([...requests, ...responses], [PERSON_PINFL]);
  });
});
