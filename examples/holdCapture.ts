/**
 * Hold, then capture or release: the booking flow against a live merchant account.
 *
 * Run with:
 *   PAYLOV_BASE_URL=… PAYLOV_CONSUMER_KEY=… PAYLOV_CONSUMER_SECRET=… \
 *   PAYLOV_USERNAME=… PAYLOV_PASSWORD=… PAYLOV_USER_ID=… PAYLOV_CARD_ID=… \
 *   npx tsx examples/holdCapture.ts
 *
 * MONEY WARNING: this holds 1 000.00 SUM on a real card for 10 minutes and captures all of it.
 * Set CAPTURE=false to release the hold instead.
 */

// In your own code this is `from '@isroilov_an/paylov'`; in-repo it resolves to the same entry point.
import { formatSum, isPaylovApiError, PaylovClient, readHoldState } from '../src/index.js';

// No fallbacks: a default here would become the credential of every copy of this file.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`set ${name}`);
  return value;
}

const userId = requiredEnv('PAYLOV_USER_ID');
const cardId = requiredEnv('PAYLOV_CARD_ID'); // an already bound card
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
// Store one externalId per hold before the call: it finds the hold if the answer is lost.
const externalId = `example-${Date.now()}`;

try {
  const hold = await paylov.holds.create({
    userId,
    cardId,
    amountTiyin,
    durationMinutes: 10,
    externalId,
  });
  console.log(
    'hold created: %s, capture before %s',
    hold.transactionId,
    hold.clientCaptureDeadline.toISOString(),
  );

  const status = await paylov.holds.get({ externalId });
  const state = readHoldState({
    hold: status,
    clientCaptureDeadline: hold.clientCaptureDeadline,
    now: new Date(),
  });
  console.log('state=%s amount=%s SUM', state.kind, formatSum(status.amountTiyin));

  if (capture) {
    // Capture is single-use: the remainder cannot be captured later, and the SDK assumes Paylov
    // releases it to the cardholder. After the duration, capture fails with hold_time_expired
    // although the status still reads `held`.
    const captured = await paylov.holds.capture({ transactionId: hold.transactionId, amountTiyin });
    console.log('captured at %s', captured.capturedAt.toISOString());
  } else {
    // Release charges nothing, so nothing needs a refund.
    await paylov.holds.release({ transactionId: hold.transactionId });
    console.log('released');
  }
} catch (error) {
  if (isPaylovApiError(error, 'hold_time_expired')) {
    console.error('hold expired');
  } else if (isPaylovApiError(error, 'transaction_not_available_for_payment', 'hold_not_found')) {
    // Already captured or released (or, for a release, expired): read it instead of retrying.
    const hold = await paylov.holds.get({ externalId });
    console.error('hold already settled: %s', hold.status);
  } else {
    // A connection or protocol error leaves the outcome unknown: reconcile with
    // holds.get({ externalId }) before acting again, never by repeating the call.
    throw error;
  }
} finally {
  await paylov.close();
}
