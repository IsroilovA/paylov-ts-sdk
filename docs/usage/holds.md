# Holds

A hold reserves money on a bound card; `capture` charges it, `release` gives it back. For a booking:
reserve at booking, capture after the visit, release on cancellation.

## Flow

```ts
// Store the externalId, the held amount and the creation time before the call.
const externalId = `booking-${booking.id}`; // at most 64 characters, unique per merchant
await bookings.saveHoldIntent(booking.id, {
  externalId,
  heldTiyin: booking.priceTiyin,
  createdAt: new Date(),
});

const hold = await paylov.holds.create({
  userId: booking.customerId,
  cardId: booking.cardId,
  amountTiyin: booking.priceTiyin, // whole SUM, at least 10 SUM
  durationMinutes: 3 * 24 * 60, // at most 28 days
  externalId,
});

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
  which Paylov's test environment refuses for captured holds; the fallback is the Paylov business
  panel or Paylov support. Capture only the final amount so refunds stay rare.
- **Track the deadline yourself.** An expired hold can still read `held`; capture then fails with
  `hold_time_expired`, and release has both failed and succeeded. Stop capturing a hold at creation
  time plus `durationMinutes`, and release every hold you will not capture, also after it expires.
  Release is the only documented way to free a hold, so the SDK reads `hold_not_found` then as
  nothing left to release; Paylov does not document release after expiry. For a date beyond 28 days,
  create the hold when the date enters the window.
- **Poll to reconcile.** Paylov sends no hold webhook: read `holds.get({ externalId })` for every
  open booking. `transactions.get` uses other words for a hold: `paid` once captured, and an expired
  hold Paylov released has read `refunded` there, like a refunded sale.

## Recovery

After an ambiguous `create`, run this from a delayed job (an immediate miss proves nothing):

```ts
import { isPaylovApiError, type CreateHoldParams } from '@isroilov_an/paylov';

export async function reconcileHold(
  bookingId: string,
  holdParams: CreateHoldParams,
): Promise<void> {
  const found = await paylov.holds.get({ externalId: holdParams.externalId });
  if (found !== null) return bookings.saveHold(bookingId, found.transactionId);
  try {
    const hold = await paylov.holds.create(holdParams); // same externalId
    await bookings.saveHold(bookingId, hold.transactionId);
  } catch (error) {
    if (!isPaylovApiError(error, 'external_id_already_exists')) throw error;
    const existing = await paylov.holds.get({ externalId: holdParams.externalId });
    if (existing === null) return jobs.retryLater(bookingId); // not visible yet
    await bookings.saveHold(bookingId, existing.transactionId);
  }
}
```

For `capture` and `release`, read `holds.get` first; see
[errors.md](errors.md#recovery-after-an-ambiguous-failure).
