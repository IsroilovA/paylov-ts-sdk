import { describe, expect, it } from 'vitest';

import { createFiscalizationResource } from '../../src/fiscalization/resource.js';
import type { AttachFiscalReceiptParams } from '../../src/index.js';
import {
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import {
  fixtureResponse,
  loadFixture,
  patchedResponse,
  wireResponse,
} from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

const TRANSACTION_ID = '5eed0000-0000-4000-8000-000000000001';
const PHONE = '+998900000000';
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
      fixtureResponse('fiscalization/register.success.docs.json'),
    );

    const receipt = await resource.registerReceipt(REGISTER);

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/fiscalization/register/`,
      body: { transactionId: TRANSACTION_ID, items: [{ ...WIRE_ITEM, tin: '123456789' }] },
    });
    expect(receipt).toEqual({
      receiptId: 987654,
      receiptUrl: 'https://ofd.example.com/receipt/12345',
      terminalId: 'T123456',
      fiscalSign: 'FS123ABC',
    });
  });

  it('registers a cash sale by externalId and phoneNumber', async () => {
    const { resource, fetchImpl } = setup(
      fixtureResponse('fiscalization/register.success.docs.json'),
    );

    await resource.registerReceipt({
      externalId: 'cash-0001',
      phoneNumber: PHONE,
      items: [{ ...ITEM, pinfl: ITEM_PINFL }],
    });

    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({
      externalId: 'cash-0001',
      phoneNumber: PHONE,
      items: [{ ...WIRE_ITEM, pinfl: ITEM_PINFL }],
    });
  });

  it.each([
    [{}, undefined, 'exclusive'],
    [
      { transactionId: TRANSACTION_ID, externalId: 'cash-0001', phoneNumber: PHONE },
      undefined,
      'exclusive',
    ],
    [{ externalId: 'cash-0001' }, 'phoneNumber', 'required'],
  ] as const)('rejects ids %j before any request', async (ids, field, rule) => {
    const { resource, fetchImpl } = setup();

    await expectInputError(
      resource.registerReceipt({ ...ids, items: [{ ...ITEM, tin: '123456789' }] } as never),
      { field, rule },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('reports a result without receiptId as malformed', async () => {
    const { resource } = setup(
      fixtureResponse('fiscalization/register.missingReceiptId.synthesized.json'),
    );

    await expectMalformed(resource.registerReceipt(REGISTER), 'result.ofd.receiptId');
  });

  it('exposes nested gateway validation as flattened wire field paths', async () => {
    const { resource } = setup(wireResponse('fiscalization/register.nestedValidation.wire.json'));

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

  it('keeps phones, PINFLs and echoed tax ids out of errors and logger events', async () => {
    const { resource, requests, responses } = setup(
      fixtureResponse('fiscalization/register.commitentNotActive.docs.json', { status: 400 }),
    );

    const error = await expectApiError(
      resource.registerReceipt({
        externalId: 'cash-0001',
        phoneNumber: PHONE,
        items: [{ ...ITEM, pinfl: ITEM_PINFL }],
      }),
      { code: 'ofd_commitent_or_subcommission_not_active' },
    );
    const secrets = [PHONE, ITEM_PINFL, '123456789', 'cash-0001'];
    expectNoSecretLeak(error, secrets);
    expectNoSecretLeak([...requests, ...responses], secrets);
  });
});

describe('fiscalization.getReceipt', () => {
  it('reads a receipt by transactionId with the isRefund filter', async () => {
    const { resource, fetchImpl } = setup(
      fixtureResponse('fiscalization/getReceipt.success.docs.json'),
    );

    const receipt = await resource.getReceipt({ transactionId: TRANSACTION_ID, isRefund: false });

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'GET',
      url: `${BASE_URL}/merchant/fiscalization/status/?transactionId=${TRANSACTION_ID}&refunded=false`,
    });
    expect(receipt).toEqual({
      receiptId: 173723,
      receiptUrl: 'https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001',
      terminalId: 'EP000000000378',
      fiscalSign: '947030008479',
      isRefund: false,
    });
  });

  it('reads by externalId alone, without leaking it into logger events', async () => {
    const { resource, fetchImpl, requests, responses } = setup(
      fixtureResponse('fiscalization/getReceipt.success.docs.json'),
    );

    await resource.getReceipt({ externalId: 'cash/0001' });

    expect(fetchImpl.calls[0]?.url).toBe(
      `${BASE_URL}/merchant/fiscalization/status/?externalId=cash%2F0001`,
    );
    expectNoSecretLeak([...requests, ...responses], ['cash/0001', 'cash%2F0001']);
  });

  it('returns null for the live no-receipt answer', async () => {
    const { resource } = setup(wireResponse('fiscalization/getReceipt.noReceipt.wire.json'));

    expect(await resource.getReceipt({ transactionId: TRANSACTION_ID })).toBeNull();
  });

  it('returns null for an unknown externalId, which names the receipt itself', async () => {
    const { resource } = setup(
      fixtureResponse('fiscalization/getReceipt.checkNotFound.synthesized.json', { status: 400 }),
    );

    expect(await resource.getReceipt({ externalId: 'cash-0001' })).toBeNull();
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

  it.each([{}, { transactionId: TRANSACTION_ID, externalId: 'cash-0001' }])(
    'requires exactly one identifier: %j',
    async (params) => {
      const { resource, fetchImpl } = setup();

      await expectInputError(resource.getReceipt(params as never), {
        field: undefined,
        rule: 'exclusive',
      });
      expect(fetchImpl.calls).toHaveLength(0);
    },
  );
});

describe('fiscalization.attachReceipt', () => {
  type WireAttachRequest = Omit<AttachFiscalReceiptParams, 'issuedAtRaw' | 'receiptUrl'> & {
    readonly dateTime: string;
    readonly qrCodeUrl: string;
  };
  const wireRequest = loadFixture<WireAttachRequest>(
    'fiscalization/attachReceipt.request.docs.json',
  );
  const { dateTime, qrCodeUrl, ...sameNames } = wireRequest;
  const request: AttachFiscalReceiptParams = {
    ...sameNames,
    issuedAtRaw: dateTime,
    receiptUrl: qrCodeUrl,
  };

  it('sends the documented request and accepts success: true', async () => {
    const { resource, fetchImpl } = setup(
      fixtureResponse('fiscalization/attachReceipt.success.docs.json'),
    );

    await expect(resource.attachReceipt(request)).resolves.toBeUndefined();

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/fiscalization/set-receipt/`,
    });
    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual(wireRequest);
  });

  it('treats anything but success: true as malformed', async () => {
    const { resource } = setup({ body: { result: { success: false, error: null } } });

    await expectMalformed(resource.attachReceipt(request), 'result.success');
  });

  it.each([
    [{ receiptUrl: '' }, 'receiptUrl', 'required'],
    [{ receiptId: '1' }, 'receiptId', 'type'],
  ] as const)('rejects %j before any request', async (override, field, rule) => {
    const { resource, fetchImpl } = setup();

    await expectInputError(resource.attachReceipt({ ...request, ...override } as never), {
      field,
      rule,
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
