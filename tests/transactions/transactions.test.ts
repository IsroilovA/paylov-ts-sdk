import { describe, expect, it } from 'vitest';

import { createTransactionsResource } from '../../src/transactions/resource.js';
import {
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { fixtureResponse, loadWire, patchedResponse, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

const RECEIPT_ID = '5eed0000-0000-4000-8000-000000000001';
const CARD_ID = '5eed0000-0000-4000-8000-000000000002';
const FAILED_ID = '5eed0000-0000-4000-8000-000000000003';
const HOLD_ID = '5eed0000-0000-4000-8000-000000000009';
const CHECKOUT_ID = '5eed0000-0000-4000-8000-00000000000a';
const RELEASED_HOLD_ID = '5eed0000-0000-4000-8000-00000000000f';
const DOCS_ID = '3667c3fb-68a5-4d1c-bd86-99df49c895d9';
const FULL_PAN = ['860000', '123456', '7890'].join('');

function setup(script: FakeResponseSpec[]) {
  return setupResource(createTransactionsResource, script);
}

/** The paid `get` recording with its single row patched, for malformed-row cases. */
function withPaidRow(edit: (row: Record<string, unknown>) => unknown): FakeResponseSpec {
  return patchedResponse('transactions/get.paid.wire.json', ['result', 'transactions', 0], edit);
}

describe('transactions.get', () => {
  it('requests the id and decodes a created receipt', async () => {
    const { resource, fetchImpl } = setup([wireResponse('transactions/get.created.wire.json')]);

    const transaction = await resource.get({ transactionId: RECEIPT_ID });

    expect(fetchImpl.calls[0]?.method).toBe('GET');
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/getTransactions/?id=${RECEIPT_ID}`);
    expect(transaction).toEqual({
      transactionId: RECEIPT_ID,
      externalId: null,
      userId: 'user-example-1',
      cardId: null,
      maskedCardNumber: null,
      amountTiyin: 100_000,
      status: 'created',
      declineCode: null,
      paidOrCreatedAt: new Date('2026-11-12T20:52:20+05:00'),
      cancelledAt: null,
      isHold: false,
      isSplit: false,
      isA2c: false,
      isCheckout: false,
      fiscalReceipts: [],
    });
  });

  it('maps payed to paid and reads the card and payment time', async () => {
    const { resource } = setup([wireResponse('transactions/get.paid.wire.json')]);

    const transaction = await resource.get({ transactionId: RECEIPT_ID });

    expect(transaction).toMatchObject({
      status: 'paid',
      cardId: CARD_ID,
      maskedCardNumber: '860000******0000',
      paidOrCreatedAt: new Date('2026-11-12T20:52:31+05:00'),
    });
  });

  it('reads a refunded sale (wire cancel) as refunded with the Tashkent cancel time', async () => {
    const { resource } = setup([wireResponse('transactions/get.cancelled.wire.json')]);

    const transaction = await resource.get({ transactionId: RECEIPT_ID });

    expect(transaction).toMatchObject({
      status: 'refunded',
      cancelledAt: new Date('2026-11-12T20:54:08+05:00'),
      paidOrCreatedAt: new Date('2026-11-12T20:52:31+05:00'),
      amountTiyin: 100_000,
    });
  });

  it('exposes the decline code of a failed payment', async () => {
    const { resource } = setup([wireResponse('transactions/get.failed.wire.json')]);

    const transaction = await resource.get({ transactionId: FAILED_ID });

    expect(transaction).toMatchObject({
      status: 'failed',
      declineCode: 'processing_error',
      amountTiyin: 100,
    });
  });

  it('reads an uncaptured hold (wire waiting) as held', async () => {
    const { resource } = setup([wireResponse('transactions/get.waitingHold.wire.json')]);

    const transaction = await resource.get({ transactionId: HOLD_ID });

    expect(transaction).toMatchObject({
      status: 'held',
      isHold: true,
      externalId: 'hold-example-1',
      amountTiyin: 500_000,
    });
  });

  it('reads an expired hold Paylov released (wire refunded) as refunded', async () => {
    const { resource } = setup([wireResponse('transactions/get.releasedHold.wire.json')]);

    const transaction = await resource.get({ transactionId: RELEASED_HOLD_ID });

    expect(transaction).toMatchObject({
      status: 'refunded',
      isHold: true,
      cancelledAt: new Date('2026-11-14T12:04:50+05:00'),
      amountTiyin: 100_000,
    });
  });

  it('marks a checkout transaction', async () => {
    const { resource } = setup([wireResponse('transactions/get.checkout.wire.json')]);

    const transaction = await resource.get({ transactionId: CHECKOUT_ID });

    expect(transaction).toMatchObject({ isCheckout: true, userId: null, amountTiyin: 50_000 });
  });

  it('decodes fiscal receipts and keeps their time raw', async () => {
    const { resource } = setup([fixtureResponse('transactions/get.withReceipts.docs.json')]);

    const transaction = await resource.get({ transactionId: DOCS_ID });

    expect(transaction).toMatchObject({
      status: 'paid',
      externalId: 'order-12345',
      isCheckout: true,
    });
    expect(transaction?.fiscalReceipts).toEqual([
      {
        receiptId: 123_456,
        receiptUrl:
          'https://ofd.soliq.uz/epi?t=EP000000000001&r=001&c=20060102000000&s=000000000001',
        issuedAtRaw: '2026-04-01 06:38:38',
        isRefund: false,
      },
    ]);
  });

  it('passes an unknown status through', async () => {
    const { resource } = setup([withPaidRow((row) => ({ ...row, status: 'reversed' }))]);

    const transaction = await resource.get({ transactionId: RECEIPT_ID });

    expect(transaction?.status).toBe('reversed');
  });

  it('resolves to null when the gateway knows no such transaction', async () => {
    const { resource } = setup([wireResponse('transactions/get.empty.wire.json')]);

    await expect(resource.get({ transactionId: RECEIPT_ID })).resolves.toBeNull();
  });

  it('accepts an upper-case id for a lower-case row', async () => {
    const { resource } = setup([wireResponse('transactions/get.paid.wire.json')]);

    const transaction = await resource.get({ transactionId: RECEIPT_ID.toUpperCase() });

    expect(transaction?.transactionId).toBe(RECEIPT_ID);
  });

  it('fails as malformed when the rows are not the requested transaction', async () => {
    const { resource } = setup([
      wireResponse('transactions/list.paid.wire.json'),
      wireResponse('transactions/get.paid.wire.json'),
    ]);

    await expectMalformed(resource.get({ transactionId: RECEIPT_ID }), 'result.transactions');
    await expectMalformed(resource.get({ transactionId: HOLD_ID }), 'result.transactions');
  });

  it.each([
    ['id', 42],
    ['cardNumber', FULL_PAN],
    ['date', '2026-11-12T20:52:31'],
    ['cancel_time', '2026-11-12'],
    ['amount_in_tiyin', 1000.5],
    ['via_link', 'true'],
    ['ofd', null],
  ])('fails as malformed when %s is %j, without echoing the value', async (key, value) => {
    const { resource } = setup([withPaidRow((row) => ({ ...row, [key]: value }))]);

    const error = await expectMalformed(
      resource.get({ transactionId: RECEIPT_ID }),
      `result.transactions[0].${key}`,
    );
    expectNoSecretLeak(error, [FULL_PAN]);
  });

  it('fails as malformed when a documented key is absent', async () => {
    const { resource } = setup([
      withPaidRow((row) => {
        delete row['error_message'];
        return row;
      }),
    ]);

    await expectMalformed(
      resource.get({ transactionId: RECEIPT_ID }),
      'result.transactions[0].error_message',
    );
  });

  it('sends a non-UUID id unchanged and surfaces the gateway validation error', async () => {
    const { resource, fetchImpl } = setup([wireResponse('transactions/get.invalidUuid.wire.json')]);

    await expectApiError(resource.get({ transactionId: 'not-a-uuid' }), {
      code: 'validation_error',
      fields: ['transactionId'],
    });
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/getTransactions/?id=not-a-uuid`);
  });
});

describe('transactions.list', () => {
  it('sends no query without params and decodes the page', async () => {
    const { resource, fetchImpl } = setup([wireResponse('transactions/list.paid.wire.json')]);

    const page = await resource.list();

    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/getTransactions/`);
    expect(page.total).toBe(6);
    expect(page.transactions.map((row) => [row.status, row.isHold, row.isCheckout])).toEqual([
      ['paid', false, true],
      ['paid', true, false],
      ['paid', true, false],
      ['paid', false, false],
      ['paid', false, false],
      ['paid', false, false],
    ]);
    // A captured hold reports the captured amount, not the held one.
    expect(page.transactions[2]).toMatchObject({
      transactionId: HOLD_ID,
      amountTiyin: 400_000,
      paidOrCreatedAt: new Date('2026-11-12T21:00:11+05:00'),
    });
  });

  it('maps the dates and page onto the wire query', async () => {
    const { resource, fetchImpl } = setup([wireResponse('transactions/list.pastEnd.wire.json')]);

    const page = await resource.list({ fromDate: '2026-11-01', toDate: '2026-11-30', page: 2 });

    expect(fetchImpl.calls[0]?.url).toBe(
      `${BASE_URL}/merchant/getTransactions/?beginDate=2026-11-01&endDate=2026-11-30&page=2`,
    );
    expect(page).toEqual({ total: 1, transactions: [] });
  });

  it.each([
    ['fromDate', { fromDate: 20261101 }, 'type'],
    ['page', { page: 1.5 }, 'type'],
  ] as const)('rejects an invalid %s before any request', async (field, params, rule) => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(resource.list(params as never), { field, rule });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('sends a date with a time unchanged and surfaces the rejected filter by wire name', async () => {
    const { resource, fetchImpl } = setup([wireResponse('transactions/list.badDate.wire.json')]);

    await expectApiError(resource.list({ fromDate: '2026-11-01 00:00:00' }), {
      code: 'field_not_valid',
      fields: ['beginDate'],
    });
    expect(new URL(fetchImpl.calls[0]?.url ?? '').searchParams.get('beginDate')).toBe(
      '2026-11-01 00:00:00',
    );
  });

  it('fails as malformed without a total', async () => {
    const { resource } = setup([{ body: { result: { transactions: [] }, error: null } }]);

    await expectMalformed(resource.list(), 'result.totalTransaction');
  });
});

function listPage(total: number, rows: readonly Record<string, unknown>[]): FakeResponseSpec {
  return { body: { result: { totalTransaction: total, transactions: rows }, error: null } };
}

function idsOf(rows: readonly Record<string, unknown>[]): unknown[] {
  return rows.map((row) => row['id']);
}

async function collectIds(
  iterable: AsyncIterable<{ readonly transactionId: string }>,
): Promise<string[]> {
  const seen: string[] = [];
  for await (const transaction of iterable) seen.push(transaction.transactionId);
  return seen;
}

describe('transactions.iterate', () => {
  // Rows replayed from the paid-list recording, split into synthesized pages: the page size is
  // undocumented, so the iterator must rely only on `total`, empty pages and fresh rows.
  const recorded = recordOf(recordOf(loadWire('transactions/list.paid.wire.json').body)['result']);
  const ROWS = (Array.isArray(recorded['transactions']) ? recorded['transactions'] : []).map(
    recordOf,
  );
  it('fetches pages in order until the rows seen reach the total', async () => {
    const { resource, fetchImpl } = setup([
      listPage(6, ROWS.slice(0, 4)),
      listPage(6, ROWS.slice(4)),
    ]);

    const seen = await collectIds(
      resource.iterate({ fromDate: '2026-11-01', toDate: '2026-11-30' }),
    );

    expect(seen).toEqual(idsOf(ROWS));
    expect(fetchImpl.calls.map((call) => call.url)).toEqual([
      `${BASE_URL}/merchant/getTransactions/?beginDate=2026-11-01&endDate=2026-11-30&page=1`,
      `${BASE_URL}/merchant/getTransactions/?beginDate=2026-11-01&endDate=2026-11-30&page=2`,
    ]);
  });

  it('stops at an empty page even when the total says more', async () => {
    const { resource, fetchImpl } = setup([listPage(9, ROWS.slice(0, 3)), listPage(9, [])]);

    expect(await collectIds(resource.iterate())).toEqual(idsOf(ROWS.slice(0, 3)));
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('makes one request for an empty range', async () => {
    const { resource, fetchImpl } = setup([listPage(0, [])]);

    expect(await collectIds(resource.iterate())).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('yields a row that shifted onto the next page once', async () => {
    // A payment arriving between requests pushes the last row of page 1 onto page 2.
    const { resource } = setup([
      listPage(6, ROWS.slice(0, 3)),
      listPage(6, ROWS.slice(2, 5)),
      listPage(6, ROWS.slice(5)),
    ]);

    expect(await collectIds(resource.iterate())).toEqual(idsOf(ROWS));
  });

  it('reads on past one page of only seen rows, as a full page of new payments leaves', async () => {
    // Three payments arrive after page 1, so page 2 repeats it; page 3 then holds the rest.
    const { resource } = setup([
      listPage(6, ROWS.slice(0, 3)),
      listPage(9, ROWS.slice(0, 3)),
      listPage(9, ROWS.slice(3)),
      listPage(9, []),
    ]);

    expect(await collectIds(resource.iterate())).toEqual(idsOf(ROWS));
  });

  it('fails instead of looping when two pages in a row bring no new rows', async () => {
    const { resource, fetchImpl } = setup([
      listPage(6, ROWS.slice(0, 3)),
      listPage(6, ROWS.slice(0, 3)),
      listPage(6, ROWS.slice(0, 3)),
    ]);

    await expectMalformed(collectIds(resource.iterate()), 'result.transactions');
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it('checks params when called, before any request', async () => {
    const { resource, fetchImpl } = setup([]);

    await expectInputError(
      // @ts-expect-error malformed JavaScript input
      () => resource.iterate({ fromDate: 20261101 }),
      { field: 'fromDate', rule: 'type' },
    );
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('stops with sdk_aborted once the signal fires between pages', async () => {
    const controller = new AbortController();
    const { resource, fetchImpl } = setup([
      listPage(6, ROWS.slice(0, 3)),
      listPage(6, ROWS.slice(3)),
    ]);
    const seen: string[] = [];

    const loop = (async () => {
      for await (const transaction of resource.iterate({}, { signal: controller.signal })) {
        seen.push(transaction.transactionId);
        if (seen.length === 3) controller.abort();
      }
    })();

    await expect(loop).rejects.toMatchObject({ code: 'sdk_aborted', isSent: false });
    expect(seen).toEqual(idsOf(ROWS.slice(0, 3)));
    expect(fetchImpl.calls).toHaveLength(1);
  });
});

describe('transactions.getRrn', () => {
  it('puts the id in the path, logs only the route and returns the RRN', async () => {
    const { resource, fetchImpl, requests } = setup([
      wireResponse('transactions/rrn.success.wire.json'),
    ]);

    const rrn = await resource.getRrn({ transactionId: RECEIPT_ID });

    expect(rrn).toBe('000000000000');
    expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/getTransactions/rrn/${RECEIPT_ID}/`);
    expect(requests[0]?.endpoint).toBe('GET /merchant/getTransactions/rrn/{transactionId}/');
  });
});
