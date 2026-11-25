# Holds

A hold reserves money on a bound card; `capture` charges it, `release` gives it back. For a booking:
reserve at booking, capture after the visit, release on cancellation.

## Flow

```ts
// Store the externalId, the held amount and the time before the call. Replay an ambiguous create
// with the same externalId; only a new attempt after a confirmed decline gets a new one.
const externalId = `booking-${crypto.randomUUID()}`; // at most 64 characters, unique per merchant
await bookings.saveHoldIntent(booking.id, {
  externalId,
  heldTiyin: booking.priceTiyin,
  intentAt: new Date(), // precedes Paylov's creation time, also on a retry
});

const hold = await paylov.holds.create({
  userId: booking.customerId,
  cardId: booking.cardId,
  amountTiyin: booking.priceTiyin, // whole SUM, at least 10 SUM
  durationMinutes: 3 * 24 * 60, // at most 28 days
  externalId,
});
// Taken from the client clock just before the request: stop capturing at this time.
await bookings.saveHold(booking.id, hold.transactionId, hold.clientCaptureDeadline);

// Later, before the deadline: capture once, or release.
if (booking.visited) {
  await paylov.holds.capture({
    transactionId: hold.transactionId,
    amountTiyin: booking.priceTiyin,
  });
} else {
  await paylov.holds.release({ transactionId: hold.transactionId });
}
```

## Rules

- **One `externalId` per attempt.** Replaying an ambiguous `create` is the same attempt: send the
  stored `externalId` again, never a new one, or the replay can reserve the money twice. A declined
  `create` still leaves a record: `holds.get` reads it `declined` and `transactions.get` reads it
  `failed`, and creating again with the same `externalId` answers `external_id_already_exists`. Only
  after `readHoldState` confirms that decline, store a new `externalId` before the next `create`.
- **Capture once, in full unless you mean to give up the rest.** A partial capture ends the hold:
  the remainder can be neither captured nor released through the API. Paylov does not document what
  happens to it; the SDK assumes Paylov and the card's bank release it to the cardholder, on their
  schedule.
- **Keep the held amount yourself.** `holds.get` reports the captured amount after capture.
- **Release before capture; refund after.** After a capture only `payments.refund` (full) remains,
  which Paylov states works for captured holds; its test environment refused them with
  `processing_error`. The SDK reports that as an unknown outcome. Pass the `transactions.get` read
  to `readRefundState`: a captured hold still reading `paid` is `not_refunded` at the time of the
  read, so the refusal held; a hold reading `refunded` is `unknown`, because a release reads the
  same, so confirm that refund in the Paylov business panel. The fallback is the business panel or
  Paylov support. Capture only the final amount so refunds stay rare.
- **Track the deadline yourself.** An expired hold can still read `held`; capture then fails with
  `hold_time_expired`, and release has been seen both to fail and to succeed. Stop capturing a hold
  at `clientCaptureDeadline`, and release every hold you will not capture, also after it expires.
  The SDK computes the deadline from its clock (`config.now`) before sending, so it is a lower bound
  on Paylov's expiry, never proof that the hold was released. After an ambiguous `create` it is
  missing; use the stored `intentAt` plus `durationMinutes`, as below. Release is the only
  documented way to free a hold, so the SDK reads `hold_not_found` then as nothing left to release;
  Paylov does not document release after expiry. For a date beyond 28 days, create the hold when the
  date enters the window.
- **Poll to reconcile.** Paylov sends no hold webhook: read `holds.get({ externalId })` for every
  open booking. `transactions.get` uses other words for a hold: `paid` once captured, `failed` once
  declined, and `refunded` once released, by `holds.release` before or after expiry or by Paylov
  when a capture after expiry fails, like a refunded sale.

## Hold state

```ts
import { readHoldState } from '@isroilov_an/paylov';

const state = readHoldState({
  hold: await paylov.holds.get({ transactionId }),
  clientCaptureDeadline: booking.captureDeadline,
  now: new Date(),
});
```

- `open`: `held` before the deadline; capture or release it.
- `captured`, with `amountTiyin` and `capturedAt`; `released`, with `releasedAt`.
- `possibly_expired`: still reads `held` after the deadline. Capture would likely fail with
  `hold_time_expired`; release it.
- `declined`: the hold reads `declined` and `transactions.get` reads its transaction `failed`, which
  `readHoldState` needs as `transaction`: the create was declined and reserved nothing, and its
  `externalId` is used up.
- `unknown`: an unknown status, timestamps that contradict the status, or a `declined` hold without
  its `failed` transaction. Read again later.

## Recovery

After an ambiguous `create`, run this from a delayed job with backoff: `holds.get` throws
`transaction_not_found` for an unknown hold, and right after the call that proves nothing. The
create may have run even when the call was aborted, so a replay always reuses the stored
`externalId`. A record found counts as the hold only when `readHoldState` reads it as a hold;
`declined`, which needs the transaction read too, means the create ran and was refused.

```ts
import {
  isPaylovApiError,
  readHoldState,
  type CreateHoldParams,
  type Hold,
} from '@isroilov_an/paylov';

export async function reconcileHold(
  bookingId: string,
  holdParams: CreateHoldParams,
  intentAt: Date, // stored before the first create
): Promise<void> {
  // A hold the first attempt created started after intentAt, so this deadline stays a lower bound.
  const deadline = new Date(intentAt.getTime() + holdParams.durationMinutes * 60_000);
  let found: Hold;
  try {
    found = await paylov.holds.get({ externalId: holdParams.externalId });
  } catch (error) {
    if (!isPaylovApiError(error, 'transaction_not_found')) throw error;
    return createAgain(bookingId, holdParams); // still unknown after the backoff
  }
  // Paylov documents the transaction's `failed`, not the hold's: a decline needs both reads.
  const transaction =
    found.status === 'declined'
      ? await paylov.transactions.get({ transactionId: found.transactionId })
      : undefined;
  const state = readHoldState({
    hold: found,
    ...(transaction === undefined ? {} : { transaction }),
    clientCaptureDeadline: deadline,
    now: new Date(),
  });
  if (state.kind === 'declined') {
    // Nothing is reserved and the externalId is used up: a new attempt stores a new one first.
    return bookings.markHoldDeclined(bookingId);
  }
  if (state.kind === 'unknown') return jobs.retryLater(bookingId); // a status the SDK cannot settle yet
  return bookings.saveHold(bookingId, found.transactionId, deadline);
}

async function createAgain(bookingId: string, holdParams: CreateHoldParams): Promise<void> {
  try {
    const hold = await paylov.holds.create(holdParams); // same externalId
    await bookings.saveHold(bookingId, hold.transactionId, hold.clientCaptureDeadline);
  } catch (error) {
    // A record with this externalId appeared meanwhile: reconcile it on the next run.
    if (isPaylovApiError(error, 'external_id_already_exists')) return jobs.retryLater(bookingId);
    throw error;
  }
}
```

For `capture` and `release`, read `holds.get` first; see
[errors.md](errors.md#recovery-after-an-ambiguous-failure).
