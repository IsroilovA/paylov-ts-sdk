/** Compile-time contracts for `client.holds`. */

import {
  readHoldState,
  type CaptureHoldParams,
  type CreateHoldParams,
  type GetHoldParams,
  type Hold,
  type HoldCaptured,
  type HoldCreated,
  type HoldStatus,
  type PaylovClient,
  type TransactionReference,
} from '../../src/index.js';
import type { IsEqual } from './exact.js';

declare const client: PaylovClient;

const create = {
  userId: 'user-example-1',
  cardId: '5eed0000-0000-4000-8000-000000000003',
  amountTiyin: 150_000,
  durationMinutes: 60,
  externalId: 'booking-1',
  account: { bookingId: 'B-1', nights: 2 },
} satisfies CreateHoldParams;

const created: Promise<HoldCreated> = client.holds.create(create, {
  signal: AbortSignal.timeout(5_000),
});
void created;
async function storeHold(): Promise<void> {
  const hold = await client.holds.create(create);
  const deadline: Date = hold.clientCaptureDeadline;
  const durationMinutes: number = hold.durationMinutes;
  void [hold.transactionId, deadline, durationMinutes];
}
void storeHold;

declare const withoutExternalId: Omit<CreateHoldParams, 'externalId'>;
// @ts-expect-error externalId is the reconciliation key and is required
void client.holds.create(withoutExternalId);
declare const withoutUserId: Omit<CreateHoldParams, 'userId'>;
// @ts-expect-error the gateway requires userId
void client.holds.create(withoutUserId);
// @ts-expect-error amounts are tiyin; there is no SUM `amount` parameter
void client.holds.create({ ...create, amount: 1500 });
// @ts-expect-error account must be JSON
void client.holds.create({ ...create, account: { at: new Date() } });

const captured: Promise<HoldCaptured> = client.holds.capture({
  transactionId: '5eed0000-0000-4000-8000-000000000001',
  amountTiyin: 150_000,
});
void captured;
const captureParams = {
  transactionId: '5eed0000-0000-4000-8000-000000000001',
  amountTiyin: 150_000,
} satisfies CaptureHoldParams;
// @ts-expect-error amounts are tiyin; there is no SUM `amount` parameter
void client.holds.capture({ ...captureParams, amount: 1500 });
declare const withoutAmount: Omit<CaptureHoldParams, 'amountTiyin'>;
// @ts-expect-error capture needs an amount
void client.holds.capture(withoutAmount);
// @ts-expect-error the duration is durationMinutes
void client.holds.create({ ...create, timeMinutes: 60 });

const released: Promise<TransactionReference> = client.holds.release({
  transactionId: '5eed0000-0000-4000-8000-000000000001',
});
void released;

const byTransactionId = {
  transactionId: '5eed0000-0000-4000-8000-000000000001',
} satisfies GetHoldParams;
const byExternalId = { externalId: 'booking-1' } satisfies GetHoldParams;
const explicitUndefined: GetHoldParams = { ...byExternalId, transactionId: undefined };
void explicitUndefined;
// @ts-expect-error exactly one identifier
const both: GetHoldParams = { ...byTransactionId, externalId: 'b' };
// @ts-expect-error exactly one identifier
const neither: GetHoldParams = {};
void both;
void neither;

async function reconcile(): Promise<void> {
  const hold: Hold = await client.holds.get({ externalId: 'booking-1' });
  const status: HoldStatus = hold.status;
  const settled: boolean = status === 'captured' || status === 'released';
  void [status === 'held', settled];
  const unknownStatus: HoldStatus = 'expired';
  const capturedAt: Date | null = hold.capturedAt;
  const releasedAt: Date | null = hold.releasedAt;
  const amountTiyin: number = hold.amountTiyin;
  const serviceId: string = hold.serviceId;
  void [status, unknownStatus, capturedAt, releasedAt, amountTiyin, serviceId];
}
void reconcile;
// A miss throws, so get resolves exactly a hold, never null.
const getResolvesHold: IsEqual<Awaited<ReturnType<PaylovClient['holds']['get']>>, Hold> = true;
void getResolvesHold;

declare const read: Hold;
declare const deadline: Date;
const state = readHoldState({ hold: read, clientCaptureDeadline: deadline, now: deadline });
void state;
// @ts-expect-error a missing hold is a transaction_not_found error, never a null read
void readHoldState({ hold: null, clientCaptureDeadline: deadline, now: deadline });
const at = { clientCaptureDeadline: deadline, now: deadline };
// @ts-expect-error the optional transaction read is never null
void readHoldState({ hold: read, transaction: null, ...at });
