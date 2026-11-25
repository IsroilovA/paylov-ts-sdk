/**
 * Sandbox holds: create with an `externalId`, read back by it, capture in part, release a second
 * hold, the duplicate `externalId` refusal, and (`PAYLOV_LIVE_SLOW=1`) a hold after its time runs
 * out.
 */

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Hold } from '../../src/index.js';
import {
  expectRecent,
  externalId,
  liveClient,
  liveGate,
  observe,
  refused,
  settle,
} from '../helpers/live.js';
import { bindTestCard, uzcardTestCard, type BoundCard } from './sandboxCards.js';

const gate = await liveGate();
const writes = gate.enabled && gate.config.writes;
const testCard = writes ? await uzcardTestCard() : undefined;

const HOLD_TIYIN = 100_000; // 1 000 SUM
const CAPTURE_TIYIN = 40_000; // 400 SUM
const EXPIRY_WAIT_MS = 150_000;

function observeHold(label: string, hold: Hold): void {
  observe(label, {
    status: hold.status,
    amountTiyin: hold.amountTiyin,
    capturedAt: hold.capturedAt !== null,
    releasedAt: hold.releasedAt !== null,
  });
}

describe.skipIf(!gate.enabled)('holds reads', () => {
  if (!gate.enabled) return;
  const client = liveClient(gate.config);

  it('get of an unknown transactionId or externalId throws transaction_not_found', async () => {
    const miss = { code: 'transaction_not_found' };
    await expect(client.holds.get({ transactionId: randomUUID() })).rejects.toMatchObject(miss);
    await expect(client.holds.get({ externalId: externalId('unknown') })).rejects.toMatchObject(
      miss,
    );
  });
});

describe.skipIf(!writes || testCard?.ok !== true)('holds writes', () => {
  if (!gate.enabled || testCard?.ok !== true) return;
  const { config } = gate;
  const client = liveClient(config);
  const card = testCard.value;
  /** Holds this lane created and has not seen captured or released. */
  const open = new Set<string>();
  let bound: BoundCard | undefined;
  let capturedHold: { readonly transactionId: string; readonly externalId: string } | undefined;

  function boundCard(): BoundCard {
    if (bound === undefined) throw new Error('the holds lane has no card');
    return bound;
  }

  async function createHold(
    label: string,
    durationMinutes = 10,
  ): Promise<{ readonly transactionId: string; readonly externalId: string }> {
    const { userId, card: holder } = boundCard();
    const reference = externalId(label);
    const { transactionId } = await client.holds.create({
      userId,
      cardId: holder.cardId,
      amountTiyin: HOLD_TIYIN,
      durationMinutes,
      externalId: reference,
    });
    open.add(transactionId);
    return { transactionId, externalId: reference };
  }

  async function readHold(transactionId: string): Promise<Hold> {
    const hold = await client.holds.get({ transactionId });
    expect(hold.transactionId === transactionId, 'transactionId').toBe(true);
    return hold;
  }

  beforeAll(async () => {
    bound = await bindTestCard(client, card, 'holds');
  });

  afterAll(async () => {
    for (const transactionId of open) {
      await settle('holds.cleanup.release', client.holds.release({ transactionId }));
    }
    await bound?.release();
  });

  it('create, read back by externalId, capture in part, read back captured', async () => {
    const created = await createHold('capture');
    const byExternal = await client.holds.get({ externalId: created.externalId });
    observeHold('holds.get.fresh', byExternal);
    expect(byExternal.transactionId === created.transactionId, 'found by externalId').toBe(true);
    expect(byExternal).toMatchObject({
      status: 'held',
      amountTiyin: HOLD_TIYIN,
      capturedAt: null,
      releasedAt: null,
    });
    expect(byExternal.serviceId.length).toBeGreaterThan(0);

    const asTransaction = await client.transactions.get({ transactionId: created.transactionId });
    observe('transactions.get.hold', { status: asTransaction.status });
    expect(asTransaction).toMatchObject({ status: 'held', isHold: true });
    expect(asTransaction.externalId === created.externalId, 'transaction externalId').toBe(true);

    const captured = await client.holds.capture({
      transactionId: created.transactionId,
      amountTiyin: CAPTURE_TIYIN,
    });
    open.delete(created.transactionId);
    capturedHold = created;
    expect(captured.transactionId === created.transactionId, 'capture transactionId').toBe(true);
    expect(captured.cardId === boundCard().card.cardId, 'capture cardId').toBe(true);
    expectRecent('holds.capture.capturedAt', captured.capturedAt);

    const paid = await readHold(created.transactionId);
    observeHold('holds.get.captured', paid);
    expect(paid).toMatchObject({
      status: 'captured',
      amountTiyin: CAPTURE_TIYIN,
      releasedAt: null,
    });
    expectRecent('holds.get.captured.capturedAt', paid.capturedAt);

    const settled = await client.transactions.get({ transactionId: created.transactionId });
    observe('transactions.get.captured-hold', { status: settled.status });
    expect(settled).toMatchObject({ status: 'paid', amountTiyin: CAPTURE_TIYIN, isHold: true });
  });

  it('release cancels an open hold; a repeat is hold_not_found', async () => {
    const created = await createHold('release');
    const released = await client.holds.release({ transactionId: created.transactionId });
    open.delete(created.transactionId);
    expect(released.transactionId === created.transactionId, 'release transactionId').toBe(true);

    const cancelled = await readHold(created.transactionId);
    observeHold('holds.get.released', cancelled);
    expect(cancelled).toMatchObject({
      status: 'released',
      amountTiyin: HOLD_TIYIN,
      capturedAt: null,
    });
    expectRecent('holds.get.released.releasedAt', cancelled.releasedAt);

    const again = await refused(
      'holds.release.repeat',
      client.holds.release({ transactionId: created.transactionId }),
    );
    expect(again.code).toBe('hold_not_found');
  });

  it('a create reusing an externalId is external_id_already_exists', async () => {
    if (capturedHold === undefined) throw new Error('the capture step created no hold');
    const { userId, card: holder } = boundCard();
    const error = await refused(
      'holds.create.duplicate-external',
      client.holds.create({
        userId,
        cardId: holder.cardId,
        amountTiyin: HOLD_TIYIN,
        durationMinutes: 10,
        externalId: capturedHold.externalId,
      }),
    );
    expect(error.code).toBe('external_id_already_exists');
  });

  it.skipIf(!config.slow)(
    'an expired hold still reads held; capture is hold_time_expired, release hold_not_found',
    async () => {
      const created = await createHold('expiry', 1);
      await sleep(EXPIRY_WAIT_MS);
      const expired = await readHold(created.transactionId);
      observeHold('holds.get.after-expiry', expired);
      expect(expired).toMatchObject({ status: 'held', capturedAt: null, releasedAt: null });

      const capture = await refused(
        'holds.capture.after-expiry',
        client.holds.capture({ transactionId: created.transactionId, amountTiyin: HOLD_TIYIN }),
      );
      expect(capture.code).toBe('hold_time_expired');
      const release = await refused(
        'holds.release.after-expiry',
        client.holds.release({ transactionId: created.transactionId }),
      );
      expect(release.code).toBe('hold_not_found');
      open.delete(created.transactionId);
    },
    EXPIRY_WAIT_MS + 60_000,
  );
});
