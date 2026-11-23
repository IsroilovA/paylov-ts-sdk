# Holds

A hold reserves money on a bound card; `capture` charges it, `release` gives it back. For a booking:
reserve at booking, capture after the visit, release on cancellation.

## Flow

```ts
// Store the externalId, the held amount and the time before the call.
const externalId = `booking-${booking.id}`; // at most 64 characters, unique per merchant
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

- **Capture once, in full unless you mean to give up the rest.** A partial capture ends the hold:
  the remainder can be neither captured nor released through the API. Paylov does not document what
  happens to it; the SDK assumes Paylov and the card's bank release it to the cardholder, on their
  schedule.
- **Keep the held amount yourself.** `holds.get` reports the captured amount after capture.
- **Release before capture; refund after.** After a capture only `payments.refund` (full) remains,
  which Paylov's test environment refuses for captured holds with `processing_error`. The SDK
  reports that as an unknown outcome; a `transactions.get` that still reads `paid` means the refusal
  held. The fallback is the Paylov business panel or Paylov support. Capture only the final amount
  so refunds stay rare.
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
  open booking. `transactions.get` uses other words for a hold: `paid` once captured, and an expired
  hold Paylov released has read `refunded` there, like a refunded sale.

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
- `unknown`: `null`, an unknown status, or timestamps that contradict the status. Read again later.

## Recovery

After an ambiguous `create`, run this from a delayed job (an immediate miss proves nothing):

```ts
import { isPaylovApiError, type CreateHoldParams } from '@isroilov_an/paylov';

export async function reconcileHold(
  bookingId: string,
  holdParams: CreateHoldParams,
  intentAt: Date, // stored before the first create
): Promise<void> {
  // A hold the first attempt created started after intentAt, so this deadline stays a lower bound.
  const deadline = new Date(intentAt.getTime() + holdParams.durationMinutes * 60_000);
  const found = await paylov.holds.get({ externalId: holdParams.externalId });
  if (found !== null) return bookings.saveHold(bookingId, found.transactionId, deadline);
  try {
    const hold = await paylov.holds.create(holdParams); // same externalId
    await bookings.saveHold(bookingId, hold.transactionId, hold.clientCaptureDeadline);
  } catch (error) {
    if (!isPaylovApiError(error, 'external_id_already_exists')) throw error;
    const existing = await paylov.holds.get({ externalId: holdParams.externalId });
    if (existing === null) return jobs.retryLater(bookingId); // not visible yet
    await bookings.saveHold(bookingId, existing.transactionId, deadline);
  }
}
```

For `capture` and `release`, read `holds.get` first; see
[errors.md](errors.md#recovery-after-an-ambiguous-failure).
