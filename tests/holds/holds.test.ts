import { describe, expect, it } from 'vitest';

import { createHoldsResource } from '../../src/holds/resource.js';
import {
  captureAsync,
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { fixtureResponse, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

// Expectations come from docs/paylov/holds.md.
const HOLD_ID = '5eed0000-0000-4000-8000-000000000001';
const RELEASED_HOLD_ID = '5eed0000-0000-4000-8000-000000000002';
const CARD_ID = '5eed0000-0000-4000-8000-000000000003';
const SERVICE_ID = '5eed0000-0000-4000-8000-0000000000aa';
const EXTERNAL_ID = 'EXAMPLE-ORDER-REF-NOT-A-REAL-ORDER';

const CREATE = {
  userId: 'user-example-1',
  cardId: CARD_ID,
  amountTiyin: 500_000,
  durationMinutes: 30,
  externalId: EXTERNAL_ID,
};

function setup(script: FakeResponseSpec[]) {
  return setupResource(createHoldsResource, script);
}

describe('holds.create', () => {
  it('sends whole SUM and the hold minutes, and returns the transaction id', async () => {
    const { resource, fetchImpl } = setup([wireResponse('holds/create.success.wire.json')]);

    const hold = await resource.create({
      ...CREATE,
      account: { orderId: 'A-1' },
      serviceId: SERVICE_ID,
    });

    expect(hold).toEqual({ transactionId: HOLD_ID });
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]?.method).toBe('POST');
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/payment/hold/create/`);
    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({
      userId: 'user-example-1',
      cardId: CARD_ID,
      amount: 5000,
      time: 30,
      externalId: EXTERNAL_ID,
      account: { orderId: 'A-1' },
      serviceId: SERVICE_ID,
    });
  });

  it('omits account and serviceId when absent', async () => {
    const { resource, fetchImpl } = setup([wireResponse('holds/create.success.wire.json')]);

    await resource.create({ ...CREATE, amountTiyin: 1000, durationMinutes: 40_320 });

    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({
      userId: 'user-example-1',
      cardId: CARD_ID,
      amount: 10,
      time: 40_320,
      externalId: EXTERNAL_ID,
    });
  });

  it.each([
    ['a fraction of a SUM', { amountTiyin: 1050 }, 'sdk_invalid_amount', 'amountTiyin', 'format'],
    [
      'a missing amount',
      { amountTiyin: undefined },
      'sdk_invalid_amount',
      'amountTiyin',
      'required',
    ],
    [
      'fractional minutes',
      { durationMinutes: 1.5 },
      'sdk_invalid_input',
      'durationMinutes',
      'type',
    ],
    [
      'a missing externalId',
      { externalId: undefined },
      'sdk_invalid_input',
      'externalId',
      'required',
    ],
    ['a missing userId', { userId: undefined }, 'sdk_invalid_input', 'userId', 'required'],
    ['a blank userId', { userId: ' ' }, 'sdk_invalid_input', 'userId', 'required'],
    ['a string account', { account: 'A-1' }, 'sdk_invalid_input', 'account', 'type'],
  ] as const)('rejects %s before any request', async (_case, override, code, field, rule) => {
    const { resource, fetchImpl } = setup([]);
    const params: unknown = { ...CREATE, ...override };

    // @ts-expect-error malformed JavaScript input
    await expectInputError(resource.create(params), { code, field, rule });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it.each([
    ['create.amountBelowMin', { amountTiyin: 500 }, { amount: 5 }, 'validation_error', ['amount']],
    [
      'create.timeOutOfRange',
      { durationMinutes: 40_321 },
      { time: 40_321 },
      'field_not_valid',
      ['time'],
    ],
  ] as const)(
    'sends the value of %s unchanged and names the field Paylov rejects',
    async (fixture, override, sent, code, fields) => {
      const { resource, fetchImpl } = setup([wireResponse(`holds/${fixture}.wire.json`)]);

      await expectApiError(resource.create({ ...CREATE, ...override }), { code, fields });
      expect(fetchImpl.calls[0]?.body).toMatchObject(sent);
    },
  );

  it('rejects a success without a transaction id', async () => {
    const { resource } = setup([fixtureResponse('holds/create.malformed.synthesized.json')]);

    await expectMalformed(resource.create(CREATE), 'result.transactionId');
  });

  it('keeps the externalId and userId out of errors and logger events', async () => {
    const { resource, requests, responses } = setup([
      wireResponse('holds/create.duplicateExternalId.wire.json'),
    ]);

    const error = await captureAsync(resource.create(CREATE));
    const tooLong = await captureAsync(
      resource.create({ ...CREATE, externalId: `${EXTERNAL_ID}-${'x'.repeat(64)}` }),
    );

    expectNoSecretLeak(error, [EXTERNAL_ID, CREATE.userId]);
    expectNoSecretLeak(tooLong, [EXTERNAL_ID]);
    expect(JSON.stringify([requests, responses])).not.toMatch(/EXAMPLE-ORDER|user-example/);
  });
});

describe('holds.capture', () => {
  it('sends whole SUM and decodes the UTC capture time', async () => {
    const { resource, fetchImpl } = setup([wireResponse('holds/capture.success.wire.json')]);

    const captured = await resource.capture({ transactionId: HOLD_ID, amountTiyin: 400_000 });

    expect(captured).toEqual({
      transactionId: HOLD_ID,
      cardId: CARD_ID,
      capturedAt: new Date('2026-11-12T16:00:11Z'),
    });
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/payment/hold/charge/`);
    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({ transactionId: HOLD_ID, amount: 4000 });
  });

  it.each([
    [
      'a fraction of a SUM',
      { amountTiyin: 100_001 },
      'sdk_invalid_amount',
      'amountTiyin',
      'format',
    ],
    ['a negative amount', { amountTiyin: -1000 }, 'sdk_invalid_amount', 'amountTiyin', 'type'],
    [
      'a blank transactionId',
      { transactionId: ' ' },
      'sdk_invalid_input',
      'transactionId',
      'required',
    ],
  ] as const)('rejects %s before any request', async (_case, override, code, field, rule) => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(
      resource.capture({ transactionId: HOLD_ID, amountTiyin: 400_000, ...override }),
      { code, field, rule },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('surfaces a refused capture without retrying the POST', async () => {
    const { resource, fetchImpl } = setup([wireResponse('holds/capture.overHeld.wire.json')]);

    await expectApiError(resource.capture({ transactionId: HOLD_ID, amountTiyin: 1000 }), {
      code: 'invalid_amount',
    });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('rejects a capture time that is not the documented UTC format', async () => {
    const { resource } = setup([fixtureResponse('holds/capture.malformed.synthesized.json')]);

    await expectMalformed(
      resource.capture({ transactionId: HOLD_ID, amountTiyin: 400_000 }),
      'result.payedAt',
    );
  });
});

describe('holds.release', () => {
  it('sends the transaction id and returns it', async () => {
    const { resource, fetchImpl } = setup([wireResponse('holds/release.success.wire.json')]);

    const released = await resource.release({ transactionId: RELEASED_HOLD_ID });

    expect(released).toEqual({ transactionId: RELEASED_HOLD_ID });
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/payment/hold/dismiss/`);
    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({ transactionId: RELEASED_HOLD_ID });
  });

  it('surfaces hold_not_found for a captured hold', async () => {
    const { resource } = setup([wireResponse('holds/release.afterCapture.wire.json')]);

    await expectApiError(resource.release({ transactionId: HOLD_ID }), { code: 'hold_not_found' });
  });

  it('rejects a blank transactionId before any request', async () => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(resource.release({ transactionId: '' }), {
      field: 'transactionId',
      rule: 'required',
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('holds.get', () => {
  it('looks a hold up by transactionId and reads the SUM amount as tiyin', async () => {
    const { resource, fetchImpl } = setup([wireResponse('holds/get.hold.wire.json')]);

    const hold = await resource.get({ transactionId: HOLD_ID });

    expect(hold).toEqual({
      transactionId: HOLD_ID,
      status: 'held',
      amountTiyin: 500_000,
      capturedAt: null,
      releasedAt: null,
      serviceId: SERVICE_ID,
    });
    expect(fetchImpl.calls[0]?.method).toBe('GET');
    expect(fetchImpl.calls[0]?.url).toBe(
      `${BASE_URL}/merchant/payment/hold/status/?transactionId=${HOLD_ID}`,
    );
  });

  it('looks a hold up by externalId alone and keeps it out of logger events', async () => {
    const { resource, fetchImpl, requests } = setup([wireResponse('holds/get.hold.wire.json')]);

    await resource.get({ externalId: 'order 1/2' });

    expect(fetchImpl.calls[0]?.url).toBe(
      `${BASE_URL}/merchant/payment/hold/status/?externalId=order%201%2F2`,
    );
    expect(requests).toEqual([
      { method: 'GET', endpoint: 'GET /merchant/payment/hold/status/', attempt: 1 },
    ]);
  });

  it('reports a paid hold as captured, with the captured amount and UTC capture time', async () => {
    const { resource } = setup([wireResponse('holds/get.paid.wire.json')]);

    const hold = await resource.get({ transactionId: HOLD_ID });

    expect(hold).toMatchObject({
      status: 'captured',
      amountTiyin: 400_000,
      capturedAt: new Date('2026-11-12T16:00:11Z'),
      releasedAt: null,
    });
  });

  it('reports a cancelled hold as released, with the UTC release time', async () => {
    const { resource } = setup([wireResponse('holds/get.cancelled.wire.json')]);

    const hold = await resource.get({ transactionId: RELEASED_HOLD_ID });

    expect(hold).toMatchObject({
      status: 'released',
      amountTiyin: 300_000,
      capturedAt: null,
      releasedAt: new Date('2026-11-12T16:00:21Z'),
    });
  });

  it("passes the caller's signal to the request", async () => {
    const { resource } = setup([{ ...wireResponse('holds/get.hold.wire.json'), delayMs: 1_000 }]);
    const controller = new AbortController();

    const pending = captureAsync(
      resource.get({ transactionId: HOLD_ID }, { signal: controller.signal }),
    );
    controller.abort();

    await expect(pending).resolves.toMatchObject({ code: 'sdk_aborted' });
  });

  it('returns null for transaction_not_found', async () => {
    const { resource, fetchImpl } = setup([wireResponse('holds/get.notFound.wire.json')]);

    await expect(resource.get({ externalId: EXTERNAL_ID })).resolves.toBeNull();
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('throws any other gateway error instead of returning null', async () => {
    const { resource } = setup([wireResponse('holds/get.missingIdentifier.wire.json')]);

    await expectApiError(resource.get({ transactionId: HOLD_ID }), { code: 'validation_error' });
  });

  it.each([
    ['neither identifier', {}],
    ['both identifiers', { transactionId: HOLD_ID, externalId: EXTERNAL_ID }],
  ])('rejects %s before any request', async (_case, params: unknown) => {
    const { resource, fetchImpl } = setup([]);

    // @ts-expect-error malformed JavaScript input
    await expectInputError(resource.get(params), { field: undefined, rule: 'exclusive' });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it.each([
    ['get.fractionalAmount', 'result.amount'],
    ['get.amountOverflow', 'result.amount'],
    ['get.missingServiceId', 'result.serviceId'],
  ])('rejects %s at %s', async (fixture, path) => {
    const { resource } = setup([fixtureResponse(`holds/${fixture}.synthesized.json`)]);

    await expectMalformed(resource.get({ transactionId: HOLD_ID }), path);
  });
});
