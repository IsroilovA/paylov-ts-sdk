# Money and time

## Money is tiyin

Public money is a non-negative safe integer in tiyin (1 SUM = 100 tiyin), in fields ending in
`Tiyin`. The SDK converts to each endpoint's wire unit and never rounds; responses are converted
back to tiyin.

```ts
import { formatSum, sumToTiyin } from '@isroilov_an/paylov';

sumToTiyin(1000); // 100000 (whole SUM)
sumToTiyin('1250.50'); // 125050 (exact decimal text, e.g. from a form or a database)
formatSum(2_500_000); // '25 000.00', for display only; never send it
```

Some endpoints take whole SUM on the wire, so their amounts must be multiples of 100 tiyin
(`sdk_invalid_amount` otherwise): `sumToTiyin('10.50')` is a valid fiscal item price but fails on
`payments.create`. Paylov checks the bounds itself.

| Methods                                       | Wire unit | Pitfall                                                                                                                  |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `payments.create`, `payments.startPanPayment` | Whole SUM | Zero is rejected by the gateway                                                                                          |
| `holds.create`, `holds.capture`               | Whole SUM | At least 10 SUM; a capture above the held amount fails                                                                   |
| `splits.create` recipient `amountTiyin`       | Tiyin     | The recipient amounts must add up to the transaction amount                                                              |
| Fiscal item `priceTiyin` and `discountTiyin`  | Tiyin     | For `registerReceipt`, lines must total the transaction amount ([fiscalization.md](fiscalization.md#register-a-receipt)) |

## Dates and times

Fields ending in `At` are `Date` values; some are `Date | null` until the event happens, such as a
hold's `capturedAt` and `releasedAt` and a transaction's `cancelledAt`. Paylov sends most timestamps
without a zone; the SDK applies the zone observed on the development gateway:

| Fields                                                                                                               | Zone applied              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Transaction times (`transactions.get`, `transactions.list`), `payments.refund` `refundedAt`, split share `createdAt` | Tashkent, fixed UTC+05:00 |
| Hold `capturedAt` and `releasedAt`, transaction `fiscalReceipts[].issuedAt`                                          | UTC                       |
| Webhook times                                                                                                        | Unix seconds              |

- One event can arrive in two zones (a hold capture in UTC, its transaction in Tashkent); as `Date`
  values they compare correctly.
- Date filters (`fromDate`, `toDate`) are `YYYY-MM-DD` calendar days.
- A REST response timestamp in an unexpected format fails as `sdk_malformed_response` rather than
  being guessed. A webhook with a malformed `cancel_time` reads as
  `{ kind: 'invalid', reason: 'invalid_params' }`.
