/**
 * Hold, then capture or release: the booking flow against a live merchant account, safe to rerun.
 *
 * Run with:
 *   PAYLOV_BASE_URL=… PAYLOV_CONSUMER_KEY=… PAYLOV_CONSUMER_SECRET=… \
 *   PAYLOV_USERNAME=… PAYLOV_PASSWORD=… PAYLOV_USER_ID=… PAYLOV_CARD_ID=… \
 *   PAYLOV_HOLD_EXTERNAL_ID=… PAYLOV_HOLD_INTENT_AT=… npx tsx examples/holdCapture.ts
 *
 * PAYLOV_HOLD_EXTERNAL_ID and PAYLOV_HOLD_INTENT_AT (an ISO time no later than the first run)
 * belong to one booking: store both before the first run and pass the same values on every rerun.
 * Each run reads the hold by that externalId before acting, so a rerun after a lost answer never
 * reserves or captures twice.
 *
 * MONEY WARNING: this holds 1 000.00 SUM on a real card for 10 minutes and captures all of it.
 * Set CAPTURE=false to release the hold instead.
 */

import { setTimeout as delay } from 'node:timers/promises';

// In your own code this is `from '@isroilov_an/paylov'`; in-repo it resolves to the same entry point.
import {
  isPaylovApiError,
  isPaylovOutcomeUnknown,
  PaylovClient,
  readHoldState,
  type Hold,
  type HoldCreated,
} from '../src/index.js';

// No fallbacks: a default here would become the credential of every copy of this file.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`set ${name}`);
  return value;
}

const userId = requiredEnv('PAYLOV_USER_ID');
const cardId = requiredEnv('PAYLOV_CARD_ID'); // an already bound card
const externalId = requiredEnv('PAYLOV_HOLD_EXTERNAL_ID');
const intentAt = new Date(requiredEnv('PAYLOV_HOLD_INTENT_AT'));
if (Number.isNaN(intentAt.getTime())) throw new Error('PAYLOV_HOLD_INTENT_AT must be an ISO time');
const capture = process.env['CAPTURE'] !== 'false';
const paylov = new PaylovClient({
  baseUrl: requiredEnv('PAYLOV_BASE_URL'),
  consumerKey: requiredEnv('PAYLOV_CONSUMER_KEY'),
  consumerSecret: requiredEnv('PAYLOV_CONSUMER_SECRET'),
  username: requiredEnv('PAYLOV_USERNAME'),
  password: requiredEnv('PAYLOV_PASSWORD'),
});

// 1 000.00 SUM. Keep the held amount: after a capture, holds.get reports the captured amount.
const amountTiyin = 100_000;
const durationMinutes = 10;

/** A hold to settle and the time to stop capturing it. */
interface HeldBooking {
  readonly hold: Hold;
  readonly clientCaptureDeadline: Date;
}

/** The hold with this externalId, or `undefined` while Paylov reports none. */
async function findHold(): Promise<Hold | undefined> {
  try {
    return await paylov.holds.get({ externalId });
  } catch (error) {
    if (isPaylovApiError(error, 'transaction_not_found')) return undefined;
    throw error;
  }
}

/** A hold an earlier run created, whose create response this run does not have. */
async function recoverHold(): Promise<HeldBooking | undefined> {
  const hold = await findHold();
  if (hold === undefined) return undefined;
  // That hold started after intentAt, so this stays a lower bound on its expiry.
  const clientCaptureDeadline = new Date(intentAt.getTime() + durationMinutes * 60_000);
  return { hold, clientCaptureDeadline };
}

/** Creates the hold and reads it back; a miss right after an unknown outcome proves nothing. */
async function createHold(): Promise<HeldBooking | undefined> {
  let created: HoldCreated;
  try {
    created = await paylov.holds.create({
      userId,
      cardId,
      amountTiyin,
      durationMinutes,
      externalId,
    });
  } catch (error) {
    // A record with this externalId exists, possibly from a create whose answer was lost.
    if (isPaylovApiError(error, 'external_id_already_exists')) return recoverHold();
    if (!isPaylovOutcomeUnknown(error)) throw error;
    await delay(30_000);
    return recoverHold();
  }
  // Your own code stores this deadline with the booking; a rerun here recovers from intentAt.
  const hold = await findHold();
  return hold === undefined
    ? undefined
    : { hold, clientCaptureDeadline: created.clientCaptureDeadline };
}

const rerun = 'rerun later with the same externalId and intent time';

async function settle({ hold, clientCaptureDeadline }: HeldBooking): Promise<void> {
  const { transactionId } = hold;
  // Paylov documents the transaction's `failed`, not the hold's: a decline needs both reads.
  const transaction =
    hold.status === 'declined' ? await paylov.transactions.get({ transactionId }) : undefined;
  const state = readHoldState({
    hold,
    ...(transaction === undefined ? {} : { transaction }),
    clientCaptureDeadline,
    now: new Date(),
  });
  if (state.kind === 'open' && capture) {
    // Capture is single-use: the remainder cannot be captured later, and the SDK assumes Paylov
    // releases it to the cardholder.
    const captured = await paylov.holds.capture({ transactionId, amountTiyin });
    console.log('captured at %s', captured.capturedAt.toISOString());
  } else if (state.kind === 'open' || state.kind === 'possibly_expired') {
    // Release charges nothing, so nothing needs a refund.
    await paylov.holds.release({ transactionId });
    console.log('released');
  } else if (state.kind === 'declined') {
    // The decline used up the externalId: a new attempt needs a new one.
    console.error('hold declined: store a new externalId and intent time to try again');
    process.exitCode = 1;
  } else if (state.kind === 'unknown') {
    console.error('hold state unknown: %s', rerun);
    process.exitCode = 1;
  } else {
    console.log('nothing to do: %s', state.kind);
  }
}

try {
  const booking = (await recoverHold()) ?? (await createHold());
  if (booking === undefined) {
    console.error('hold outcome unknown: %s', rerun);
    process.exitCode = 1;
  } else {
    await settle(booking);
  }
} catch (error) {
  const raced = isPaylovApiError(
    error,
    'hold_time_expired',
    'transaction_not_available_for_payment',
    'hold_not_found',
  );
  if (!raced && !isPaylovOutcomeUnknown(error)) throw error;
  // The next run reads the hold before acting again; never repeat the call blindly.
  console.error('hold not settled: %s', rerun);
  process.exitCode = 1;
} finally {
  await paylov.close();
}
