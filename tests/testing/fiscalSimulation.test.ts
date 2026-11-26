import { describe, expect, it } from 'vitest';

import type { Card } from '../../src/cards/types.js';
import { PaylovClient } from '../../src/client.js';
import type { FiscalReceiptItem } from '../../src/shared/receiptItems.js';
import { PaylovFakeGateway, type PaylovFakeGatewayOptions } from '../../src/testing/gateway.js';
import { expectApiError } from '../helpers/asserts.js';

// Every simulated answer comes from docs/paylov/fiscalization.md and transactions.md.
const START = new Date('2026-11-25T06:24:45Z');
const CARD: Card = {
  cardId: '00000000-0000-4000-8000-0000000000c1',
  userId: 'user-42',
  holderName: 'EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON',
  cardName: null,
  maskedCardNumber: '860000******0000',
  balanceTiyin: 10_000_000,
  bankId: '12',
  bankName: null,
  vendor: 'Uzcard',
  processing: 'Uzcard',
  isActive: true,
  processingStatus: 'active',
  isSmsEnabled: true,
};
const PAY = { cardId: CARD.cardId, userId: CARD.userId };
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff';

function itemsOf(priceTiyin: number, count = 1): FiscalReceiptItem[] {
  return [
    {
      title: 'Consultation',
      priceTiyin,
      count,
      code: '10305008003000000',
      vatPercent: 12,
      packageCode: '1546532',
      tin: '123654987',
    },
  ];
}

function simulated(options: PaylovFakeGatewayOptions = { refundReceiptDelaySeconds: 15 }) {
  let now = START;
  const fake = new PaylovFakeGateway({
    refundWindowMinutes: 60,
    ...options,
    simulate: true,
    now: () => now,
  });
  fake.addCard(CARD, { spendableTiyin: 10_000_000 });
  const paylov = new PaylovClient(fake.clientConfig);
  const advance = (seconds: number): void => {
    now = new Date(now.getTime() + seconds * 1000);
  };
  const sell = async (amountTiyin: number): Promise<string> => {
    const { transactionId } = await paylov.payments.create({ amountTiyin });
    await paylov.payments.pay({ transactionId, ...PAY });
    return transactionId;
  };
  return { fake, paylov, advance, sell };
}

describe('the simulated gateway: fiscal receipts', () => {
  it('registers a sale receipt once, carrying the payment time', async () => {
    const { fake, paylov, advance, sell } = simulated();
    const transactionId = await sell(100_000);
    expect(await paylov.fiscalization.getReceipt({ transactionId })).toBeNull();

    advance(62);
    const receipt = await paylov.fiscalization.registerReceipt({
      transactionId,
      items: itemsOf(50_000, 2),
    });
    expect(receipt.receiptUrl).toMatch(
      new RegExp(
        `^https://ofd\\.soliq\\.uz/epi\\?t=\\w+&r=${receipt.receiptId}&c=20261125112445&s=`,
      ),
    );
    await expectApiError(
      paylov.fiscalization.registerReceipt({ transactionId, items: itemsOf(100_000) }),
      { code: 'ofd_check_already_generated' },
    );
    const sale = { ...receipt, isRefund: false };
    expect(await paylov.fiscalization.getReceipt({ transactionId })).toEqual(sale);
    expect(await paylov.fiscalization.getReceipt({ transactionId, isRefund: false })).toEqual(sale);
    expect(await paylov.fiscalization.getReceipt({ transactionId, isRefund: true })).toBeNull();
    expect((await paylov.transactions.get({ transactionId })).fiscalReceipts).toEqual([
      {
        receiptId: receipt.receiptId,
        receiptUrl: receipt.receiptUrl,
        issuedAt: START,
        isRefund: false,
      },
    ]);
    await expectApiError(paylov.fiscalization.refundReceipt({ receiptId: receipt.receiptId }), {
      code: 'receipt_not_available_for_operation',
    });
    fake.assertDone();
  });

  it('shows the refund receipt a refund registers after the chosen delay', async () => {
    const { fake, paylov, advance, sell } = simulated();
    const transactionId = await sell(100_000);
    const sale = await paylov.fiscalization.registerReceipt({
      transactionId,
      items: itemsOf(100_000),
    });
    advance(7);
    const { refundedAt } = await paylov.payments.refund({ transactionId });

    expect(await paylov.fiscalization.getReceipt({ transactionId, isRefund: true })).toBeNull();
    expect(await paylov.fiscalization.getReceipt({ transactionId })).toEqual({
      ...sale,
      isRefund: false,
    });
    advance(15);
    const refund = await paylov.fiscalization.getReceipt({ transactionId, isRefund: true });
    expect(refund).toMatchObject({ isRefund: true });
    expect(refund?.receiptId).not.toBe(sale.receiptId);
    expect(await paylov.fiscalization.getReceipt({ transactionId })).toEqual(refund);
    expect(await paylov.fiscalization.getReceipt({ transactionId, isRefund: false })).toEqual({
      ...sale,
      isRefund: false,
    });
    expect((await paylov.transactions.get({ transactionId })).fiscalReceipts).toEqual([
      expect.objectContaining({ receiptId: sale.receiptId, isRefund: false }),
      expect.objectContaining({
        receiptId: refund?.receiptId,
        issuedAt: refundedAt,
        isRefund: true,
      }),
    ]);
    await expectApiError(paylov.fiscalization.refundReceipt({ receiptId: sale.receiptId }), {
      code: 'ofd_check_already_generated',
    });
    fake.assertDone();
  });

  it('registers a captured hold for its captured amount and answers no receipt before', async () => {
    const { fake, paylov } = simulated();
    const { transactionId } = await paylov.holds.create({
      ...PAY,
      amountTiyin: 200_000,
      durationMinutes: 30,
      externalId: 'booking-1',
    });
    await paylov.holds.capture({ transactionId, amountTiyin: 150_000 });
    expect(await paylov.fiscalization.getReceipt({ transactionId })).toBeNull();
    // Items for the held amount, not the captured one.
    await expectApiError(
      paylov.fiscalization.registerReceipt({ transactionId, items: itemsOf(200_000) }),
      { code: 'invalid_amount' },
    );

    const receipt = await paylov.fiscalization.registerReceipt({
      transactionId,
      items: itemsOf(150_000),
    });
    expect(await paylov.fiscalization.getReceipt({ transactionId })).toEqual({
      ...receipt,
      isRefund: false,
    });
    fake.assertDone();
  });

  it('answers unknown transactions and receipts as the gateway does', async () => {
    const { fake, paylov } = simulated();

    await expectApiError(
      paylov.fiscalization.registerReceipt({ transactionId: UNKNOWN_ID, items: itemsOf(1000) }),
      { code: 'transaction_not_found' },
    );
    await expectApiError(paylov.fiscalization.getReceipt({ transactionId: UNKNOWN_ID }), {
      code: 'transaction_not_found',
    });
    await expectApiError(paylov.fiscalization.getReceipt({ transactionId: 'abc' }), {
      code: 'validation_error',
      fields: ['transactionId'],
    });
    await expectApiError(paylov.fiscalization.refundReceipt({ receiptId: 999 }), {
      code: 'ofd_check_not_found',
    });
    fake.assertDone();
  });

  it('leaves undocumented totals, unpaid payments and an unset refund delay unsimulated', async () => {
    const { fake, paylov, sell } = simulated({});
    const unpaid = await paylov.payments.create({ amountTiyin: 100_000 });
    await expectApiError(
      paylov.fiscalization.registerReceipt({ ...unpaid, items: itemsOf(100_000) }),
      { code: 'fake_unsimulated', httpStatus: 501 },
    );
    const transactionId = await sell(100_000);
    await expectApiError(
      paylov.fiscalization.registerReceipt({ transactionId, items: itemsOf(90_000) }),
      { code: 'fake_unsimulated', httpStatus: 501 },
    );
    await paylov.fiscalization.registerReceipt({ transactionId, items: itemsOf(100_000) });
    await paylov.payments.refund({ transactionId });
    await expectApiError(paylov.fiscalization.getReceipt({ transactionId, isRefund: true }), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    await expectApiError(paylov.transactions.get({ transactionId }), {
      code: 'fake_unsimulated',
      httpStatus: 501,
    });
    expect(() => {
      fake.assertDone();
    }).toThrow(/do not total the transaction amount/);
  });

  it('refuses refundReceiptDelaySeconds without the simulation or out of range', () => {
    expect(() => new PaylovFakeGateway({ refundReceiptDelaySeconds: 15 })).toThrow(
      'refundReceiptDelaySeconds needs simulate: true',
    );
    expect(() => new PaylovFakeGateway({ simulate: true, refundReceiptDelaySeconds: -1 })).toThrow(
      TypeError,
    );
  });
});
