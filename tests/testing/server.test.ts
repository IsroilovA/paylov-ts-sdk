import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PaylovClient, type PaylovClientConfig } from '../../src/client.js';
import { isPaylovOutcomeUnknown } from '../../src/core/errors.js';
import { PAYLOV_FAKE_OTP, type PaylovFakePanCard } from '../../src/testing/panCards.js';
import {
  startGatewaySimulator,
  type PaylovSimulator,
  type PaylovSimulatorOptions,
} from '../../src/testing/server.js';
import { decodeSimulationState } from '../../src/testing/simulationState.js';
import { readRefundState } from '../../src/transactions/state.js';
import { captureAsync, expectApiError, expectInputError } from '../helpers/asserts.js';
import { testCardNumber } from '../helpers/cardNumbers.js';
import { nodeFetch } from '../helpers/nodeFetch.js';

const USER = 'user-42';
const CARD_NUMBER = testCardNumber('860000000000001');
const PAN_CARD: PaylovFakePanCard = { cardNumber: CARD_NUMBER, cardExpiry: '9912' };
const RECIPIENT = '5eed0000-0000-4000-8000-000000000101';
const OTHER_RECIPIENT = '5eed0000-0000-4000-8000-000000000102';
const BOOKING_ITEM = {
  title: 'Consultation',
  priceTiyin: 60_000,
  count: 1,
  code: 'IKPU',
  vatPercent: 12,
  packageCode: 'PACKAGE',
  tin: 'TIN',
};
const CREDENTIALS = {
  consumerKey: 'EXAMPLE-SIMULATOR-KEY',
  consumerSecret: 'EXAMPLE-SIMULATOR-SECRET',
  username: 'EXAMPLE-SIMULATOR-USER',
  password: 'EXAMPLE-SIMULATOR-PASSWORD',
};

const running: PaylovSimulator[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((simulator) => simulator.close()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'paylov-simulator-'));
  directories.push(directory);
  return directory;
}

async function start(options: PaylovSimulatorOptions = {}): Promise<PaylovSimulator> {
  const simulator = await startGatewaySimulator({
    panCards: [PAN_CARD],
    splitRecipientIds: [RECIPIENT, OTHER_RECIPIENT],
    ...options,
  });
  running.push(simulator);
  return simulator;
}

/** A process's own client: the SDK keeps its https `baseUrl`, the helper reaches the simulator. */
function clientOf(simulator: PaylovSimulator, ca?: string): PaylovClient {
  const config: PaylovClientConfig = {
    ...CREDENTIALS,
    baseUrl: 'https://localhost',
    fetch: nodeFetch(simulator.url, ca),
  };
  return new PaylovClient(config);
}

async function bindCard(paylov: PaylovClient): Promise<string> {
  const { cardId } = await paylov.cards.startPanBinding({
    userId: USER,
    cardNumber: CARD_NUMBER,
    cardExpiry: '9912',
  });
  await paylov.cards.confirmPanBinding({ cardId, otp: PAYLOV_FAKE_OTP });
  return cardId;
}

describe('the gateway simulator server', () => {
  it('serves one simulation to several client processes', async () => {
    const simulator = await start();
    expect(simulator.url).toBe(`http://127.0.0.1:${simulator.port}`);
    const api = clientOf(simulator);
    const worker = clientOf(simulator);

    const cardId = await bindCard(api);
    const { transactionId } = await api.payments.create({ amountTiyin: 100_000 });
    await worker.payments.pay({ transactionId, cardId, userId: USER });
    expect(await api.transactions.get({ transactionId })).toMatchObject({ status: 'paid', cardId });
    await expectApiError(worker.payments.pay({ transactionId, cardId, userId: USER }), {
      code: 'transaction_already_payed',
    });
    await Promise.all([api.close(), worker.close()]);
  });

  it('continues from the state file after a restart and never stores the card number', async () => {
    const stateFile = join(temporaryDirectory(), 'state.json');
    let now = new Date('2026-11-12T10:00:00Z');
    const options = { stateFile, now: () => now };
    const first = await start(options);
    const api = clientOf(first);
    const cardId = await bindCard(api);
    const hold = await api.holds.create({
      userId: USER,
      cardId,
      amountTiyin: 100_000,
      durationMinutes: 30,
      externalId: 'booking-1',
    });
    await first.close();

    const saved = readFileSync(stateFile, 'utf8');
    expect(saved).not.toContain(CARD_NUMBER);
    expect(saved).not.toContain(PAYLOV_FAKE_OTP);

    now = new Date(now.getTime() + 10 * 60_000);
    const second = await start(options);
    const worker = clientOf(second);
    // Deleting the card leaves its open hold capturable in full.
    await worker.cards.delete({ cardId });
    await worker.holds.capture({ transactionId: hold.transactionId, amountTiyin: 100_000 });
    expect(await worker.holds.get({ transactionId: hold.transactionId })).toMatchObject({
      status: 'captured',
      capturedAt: now,
    });
    await expectApiError(worker.cards.delete({ cardId }), {
      code: 'card_not_found',
      httpStatus: 404,
    });
    await Promise.all([api.close(), worker.close()]);
  });

  it('runs a controllable clock through a hold expiry', async () => {
    let now = new Date('2026-11-12T10:00:00Z');
    const simulator = await start({ now: () => now });
    const paylov = clientOf(simulator);
    const cardId = await bindCard(paylov);
    const { transactionId } = await paylov.holds.create({
      userId: USER,
      cardId,
      amountTiyin: 100_000,
      durationMinutes: 30,
      externalId: 'booking-1',
    });

    now = new Date(now.getTime() + 31 * 60_000);
    await expectApiError(paylov.holds.capture({ transactionId, amountTiyin: 100_000 }), {
      code: 'hold_time_expired',
    });
    expect(await paylov.holds.get({ transactionId })).toMatchObject({ status: 'released' });
    await paylov.close();
  });

  it('splits and refunds a partially captured booking across state-file restarts', async () => {
    const stateFile = join(temporaryDirectory(), 'state.json');
    let now = new Date('2026-11-12T10:00:00Z');
    const options = {
      stateFile,
      now: () => now,
      refundWindowMinutes: 5,
      refundReceiptDelaySeconds: 5,
    };
    const first = await start(options);
    const api = clientOf(first);
    const cardId = await bindCard(api);
    const { transactionId } = await api.holds.create({
      userId: USER,
      cardId,
      amountTiyin: 100_000,
      durationMinutes: 30,
      externalId: 'booking-split',
    });
    const lookup = { transactionId };
    now = new Date('2026-11-12T10:10:00Z');
    const { capturedAt } = await api.holds.capture({ ...lookup, amountTiyin: 60_000 });
    now = new Date('2026-11-12T10:10:01Z');
    const recipients = [
      { recipientId: RECIPIENT, amountTiyin: 20_000, items: [BOOKING_ITEM] },
      { recipientId: OTHER_RECIPIENT, amountTiyin: 40_000 },
    ];
    await expect(api.splits.create({ ...lookup, recipients })).resolves.toEqual(lookup);
    const shares = [
      { recipientId: RECIPIENT, amountTiyin: 20_000, status: 'paid', createdAt: now },
      { recipientId: OTHER_RECIPIENT, amountTiyin: 40_000, status: 'paid', createdAt: now },
    ];
    await api.close();
    await first.close();

    const second = await start(options);
    const worker = clientOf(second);
    const split = await worker.splits.get(lookup);
    expect(split.shares).toEqual(shares);
    expect(split.receipt).toMatchObject({ isRefund: false });
    expect(split.receipt?.receiptUrl).toMatch(/^https:\/\/ofd\.soliq\.uz\/epi\?/);
    expect(await worker.fiscalization.getReceipt(lookup)).toEqual(split.receipt);
    await expectApiError(worker.splits.create({ ...lookup, recipients }), {
      code: 'split_already_done',
    });

    now = new Date('2026-11-12T10:14:59Z');
    const { refundedAt } = await worker.payments.refund(lookup);
    expect(refundedAt).toEqual(now);
    const saved = decodeSimulationState(JSON.parse(readFileSync(stateFile, 'utf8')));
    expect(saved.cards.get(cardId)?.ledger).toEqual({ takenTiyin: 0, returningTiyin: 100_000 });
    const cancelledShares = shares.map((share) => ({ ...share, status: 'cancelled' }));
    expect(await worker.splits.get(lookup)).toEqual({ shares: cancelledShares, receipt: null });
    await worker.close();
    await second.close();

    now = new Date('2026-11-12T10:15:04Z');
    const restarted = clientOf(await start(options));
    const transaction = await restarted.transactions.get(lookup);
    expect(transaction).toMatchObject({
      status: 'refunded',
      isHold: true,
      isSplit: true,
      amountTiyin: 60_000,
      paidOrCreatedAt: capturedAt,
      cancelledAt: refundedAt,
    });
    expect(readRefundState({ transaction, isCaptured: true })).toEqual({
      kind: 'refunded',
      refundedAt,
    });
    expect(await restarted.holds.get(lookup)).toMatchObject({ status: 'captured', capturedAt });
    expect(transaction.fiscalReceipts.map(({ isRefund }) => isRefund)).toEqual([false, true]);
    const refundedSplit = await restarted.splits.get(lookup);
    expect(refundedSplit).toMatchObject({ shares: cancelledShares, receipt: { isRefund: true } });
    expect(refundedSplit.receipt?.receiptId).not.toBe(split.receipt?.receiptId);
    expect(await restarted.fiscalization.getReceipt({ ...lookup, isRefund: true })).toEqual(
      refundedSplit.receipt,
    );
    await expectApiError(restarted.payments.refund(lookup), {
      code: 'transaction_not_available_for_cancel',
    });
    await restarted.close();
  });

  it('keeps a split when OFD totals fail and accepts a corrected resend', async () => {
    const paylov = clientOf(await start({ refundWindowMinutes: 60, refundReceiptDelaySeconds: 0 }));
    const cardId = await bindCard(paylov);
    const sale = await paylov.payments.create({ amountTiyin: 60_000 });
    const allocations = [
      { recipientId: RECIPIENT, amountTiyin: 30_000 },
      { recipientId: OTHER_RECIPIENT, amountTiyin: 30_000 },
    ] as const;
    const corrected = [{ ...allocations[0], items: [BOOKING_ITEM] }, allocations[1]];
    await expectApiError(paylov.splits.get(sale), { code: 'split_not_found', httpStatus: 400 });
    await expectApiError(paylov.splits.resendReceipt({ ...sale, recipients: corrected }), {
      code: 'split_not_found',
    });
    await expectApiError(paylov.splits.create({ ...sale, recipients: allocations }), {
      code: 'receipt_not_available_for_split',
    });
    await paylov.payments.pay({ ...sale, cardId, userId: USER });
    await expectApiError(paylov.splits.create({ ...sale, recipients: [allocations[0]] }), {
      code: 'invalid_amount',
    });
    await paylov.splits.create({
      ...sale,
      recipients: [
        { ...allocations[0], items: [{ ...BOOKING_ITEM, priceTiyin: 30_000 }] },
        allocations[1],
      ],
    });
    const split = await paylov.splits.get(sale);
    expect(split).toMatchObject({ shares: allocations, receipt: null });
    expect(await paylov.splits.resendReceipt({ ...sale, recipients: corrected })).toEqual({
      ...sale,
      status: 'sent_to_ofd',
    });
    expect(await paylov.splits.get(sale)).toMatchObject({
      shares: split.shares,
      receipt: { isRefund: false },
    });
    await expectApiError(paylov.splits.resendReceipt({ ...sale, recipients: corrected }), {
      code: 'ofd_check_already_generated',
    });
    await paylov.payments.refund(sale);
    expect(await paylov.splits.get(sale)).toMatchObject({
      shares: [{ status: 'cancelled' }, { status: 'cancelled' }],
      receipt: { isRefund: true },
    });
    await paylov.close();
  });

  it('rejects splitting a refunded unsplit sale and distinguishes an unknown transaction', async () => {
    const paylov = clientOf(await start({ refundWindowMinutes: 60 }));
    const unknown = { transactionId: '5eed0000-0000-4000-8000-000000000202' };
    await expectApiError(paylov.splits.get(unknown), {
      code: 'transaction_not_found',
      httpStatus: 400,
    });

    const cardId = await bindCard(paylov);
    const sale = await paylov.payments.create({ amountTiyin: 60_000 });
    await paylov.payments.pay({ ...sale, cardId, userId: USER });
    await paylov.payments.refund(sale);
    await expectApiError(
      paylov.splits.create({
        ...sale,
        recipients: [{ recipientId: RECIPIENT, amountTiyin: 60_000 }],
      }),
      { code: 'receipt_not_available_for_split' },
    );
    await expectApiError(paylov.splits.get(sale), { code: 'split_not_found' });
    await paylov.close();
  });

  it('answers what it does not simulate with fake_unsimulated and reports it', async () => {
    const problems: string[] = [];
    const simulator = await start({ onProblem: (problem) => problems.push(problem) });
    const paylov = clientOf(simulator);

    await expectApiError(paylov.gateway.listBanks(), { code: 'fake_unsimulated', httpStatus: 501 });
    await expectApiError(
      paylov.holds.release({ transactionId: '00000000-0000-4000-8000-0000000000ff' }),
      {
        code: 'fake_unsimulated',
        httpStatus: 501,
      },
    );
    const send = nodeFetch(simulator.url);
    const unknown = await send('https://localhost/merchant/unknown/', { method: 'GET' });
    expect(unknown.status).toBe(501);
    const oversized = await send('https://localhost/merchant/receipts/create/', {
      method: 'POST',
      body: 'x'.repeat(1_048_577),
    });
    expect(await oversized.json()).toMatchObject({ error: { code: 'fake_unreadable_request' } });
    const unreadable = await send('https://localhost/merchant/receipts/create/', {
      method: 'POST',
      body: '{}',
    });
    expect(await unreadable.json()).toMatchObject({ error: { code: 'fake_unreadable_request' } });

    expect(problems).toEqual([
      'unsimulated request GET /merchant/bankList/',
      'unsimulated holds.release: holds.release of an unknown or non-hold transaction',
      'unsimulated request GET (unknown route)',
      'unreadable request: the body is over 1 MiB',
      'unreadable request POST /merchant/receipts/create/ (the payments.create request decoder threw)',
    ]);
    await paylov.close();
  });

  it('answers a write it could not save as an unknown outcome', async () => {
    const problems: string[] = [];
    const simulator = await start({
      store: {
        load: () => Promise.resolve(undefined),
        save: () => Promise.reject(new Error('disk full')),
      },
      onProblem: (problem) => problems.push(problem),
    });
    const paylov = clientOf(simulator);

    const error = await expectApiError(paylov.payments.create({ amountTiyin: 100_000 }), {
      code: 'fake_state_not_saved',
      httpStatus: 501,
    });
    expect(isPaylovOutcomeUnknown(error)).toBe(true);
    expect(problems).toEqual(['state not saved after POST /merchant/receipts/create/']);
    await paylov.close();
  });

  it('refuses to start from a state it cannot read back', async () => {
    const stateFile = join(temporaryDirectory(), 'state.json');
    writeFileSync(stateFile, JSON.stringify({ version: 1, nextId: 1 }));

    await expectInputError(startGatewaySimulator({ stateFile }), {
      code: 'sdk_config_error',
      field: 'nextReceiptId',
      rule: 'required',
    });
  });

  it('refuses invalid network and store options', async () => {
    const store = { load: () => Promise.resolve(undefined), save: () => Promise.resolve() };
    for (const options of [
      { port: 70_000 },
      { host: '' },
      { stateFile: '' },
      { stateFile: 'state.json', store },
      { onProblem: 'log' as unknown as () => void },
    ]) {
      expect(await captureAsync(startGatewaySimulator(options))).toBeInstanceOf(TypeError);
    }
  });

  it('serves HTTPS with a supplied certificate', async () => {
    const directory = temporaryDirectory();
    const [keyFile, certFile] = [join(directory, 'key.pem'), join(directory, 'cert.pem')];
    const generated = spawnSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
      '-days',
      '1',
      '-keyout',
      keyFile,
      '-out',
      certFile,
    ]);
    expect(generated.status).toBe(0);
    const cert = readFileSync(certFile, 'utf8');
    const simulator = await start({ tls: { cert, key: readFileSync(keyFile, 'utf8') } });
    expect(simulator.url).toBe(`https://127.0.0.1:${simulator.port}`);

    const paylov = clientOf(simulator, cert);
    const cardId = await bindCard(paylov);
    expect(await paylov.cards.get({ cardId })).toMatchObject({ cardId, userId: USER });
    // Without trusting the certificate the request fails.
    const untrusting = clientOf(simulator);
    await expect(untrusting.cards.get({ cardId })).rejects.toMatchObject({
      code: 'sdk_network_error',
    });
    await Promise.all([paylov.close(), untrusting.close()]);
  });
});
