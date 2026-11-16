# Errors

Everything the SDK throws is a `PaylovError`, one class per origin:

| `kind`       | Class                     | Means                                                                   |
| ------------ | ------------------------- | ----------------------------------------------------------------------- |
| `input`      | `PaylovInputError`        | Rejected locally; nothing was sent. An integration bug                  |
| `closed`     | `PaylovClientClosedError` | The client was closed; the call had no effect. Retry it on a new client |
| `api`        | `PaylovApiError`          | The gateway answered with an error code                                 |
| `protocol`   | `PaylovProtocolError`     | The response did not match the endpoint's contract                      |
| `connection` | `PaylovConnectionError`   | No usable response: timeout, network error or abort                     |

Errors carry only SDK-written messages and allowlisted metadata; `error.toJSON()` is safe to log.

## Handle errors

```ts
import { isPaylovError, isPaylovOutcomeUnknown } from '@isroilov_an/paylov';

export async function chargeOrder(order: Order): Promise<ChargeResult> {
  try {
    await paylov.payments.pay({
      transactionId: order.transactionId,
      cardId: order.cardId,
      userId: order.userId,
    });
    return 'paid';
  } catch (error) {
    if (!isPaylovError(error)) throw error;
    // The charge may have happened: reconcile before acting again.
    if (isPaylovOutcomeUnknown(error)) return 'reconcile';
    if (error.kind === 'api') {
      if (error.code === 'insufficient_funds' || error.code === 'limit_exceeded') return 'declined';
    }
    console.error('paylov call failed', error.toJSON());
    throw error;
  }
}
```

- Check `isPaylovOutcomeUnknown` first, then `kind`, then `code`.
- Branch on `code`, never on `httpStatus` or `message`: one code arrives under different statuses,
  and Paylov's messages are display text.
- Unknown gateway codes still arrive as `PaylovApiError`; keep a default branch.
- Answer `sdk_client_closed` as a temporary unavailability, not a bad request: it arrives during
  shutdown, also for a request in flight ([setup.md](setup.md#create-the-client)).
- `fields` on validation errors holds the gateway's wire names (`service_id`, `items.0.title`), not
  SDK parameter names, and may be absent.

## Code groups

Each method's JSDoc names the codes worth branching on.

| Group                        | Examples                                                                                      | Do                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Credentials and access       | `invalid_grant`, `permission_denied`, `invalid_token`                                         | Fix configuration or ask Paylov; never retry automatically                       |
| Request validation           | `validation_error`, `field_required`, `field_not_valid`, `not_found`                          | Fix the call; `not_found` means the route does not exist                         |
| Infrastructure               | `rate_limit_exceeded`, `server_error`                                                         | Wait `retryAfterSeconds`; a 5xx leaves the outcome unknown                       |
| Card                         | `card_not_found`, `card_not_match`, `card_exists`, `phone_not_match`, `link_expired`          | Ask the end user for another card or corrected details                           |
| OTP and PIN                  | `invalid_otp`, `otp_expired`, `too_many_attempts`, `otp_code_already_sent`, `card_is_blocked` | Re-prompt or restart the flow; after `card_is_blocked`, wait `retryAfterSeconds` |
| Funds and declines           | `insufficient_funds`, `invalid_amount`, `do_not_honor`, `processing_error`                    | Tell the user; start a new attempt only after reconciling                        |
| Transaction state and lookup | `transaction_not_found`, `transaction_already_payed`, `hold_not_found`                        | Already done or not allowed in this state: read the record                       |
| Fiscalization                | `ofd_check_already_generated`, `ofd_error`                                                    | Fix the receipt data, or read `fiscalization.getReceipt`                         |
| Splits and sub-merchants     | `split_already_done`, `recipient_not_found`, `sub_merchant_already_created`                   | Read the split or fix the recipient data                                         |
| Merchant setup               | `gateway_not_working`, `terminal_does_not_exist`                                              | Contact Paylov                                                                   |

### Credentials and access

- `invalid_grant`: wrong username, password or consumer credentials, an account Paylov has not
  activated, an IP outside the allowlist, or a locked account. The client stays locked
  ([setup.md](setup.md#runtime-behavior)).
- `permission_denied`: the feature is not enabled for the merchant, or the gateway refused even a
  fresh token. Ask Paylov.

## Recovery after an ambiguous failure

`isPaylovOutcomeUnknown(error)` is true when the call may have run: a protocol error, a connection
error after a request was sent, or a gateway error with HTTP status 500 or above. Nothing that moves
money is retried automatically. Then:

- Read the record named below before acting again. Never repeat a money-moving call blindly.
- Repeat a call that takes an `externalId` or a `transactionId` with the same value, never a new
  one.
- A read that finds nothing, or still shows `created`, is not proof that the call did not run: read
  again with backoff before repeating.
- After `payments.pay`, keep reading while the status is `transfer`, `pending` or `held`; `failed`
  needs a new transaction. A status that stays `created` across those reads means, by the SDK's
  assumption, that the pay did not take effect (Paylov does not document it): pay again with the
  same `transactionId`, so a pay that landed late answers `transaction_already_payed` instead of
  charging twice.
- A repeated call may fail with the code in the last column; the read confirms what it means.

| Method                                                                 | Read next                                                            | Code on a repeated call                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `payments.pay`                                                         | `transactions.get`                                                   | `transaction_already_payed`: already paid                                                                    |
| `payments.refund`                                                      | `transactions.get`: `refunded` with `cancelledAt`                    | `transaction_not_available_for_cancel`: already cancelled, never paid, or not refundable by API              |
| `payments.confirmPanPayment`                                           | `transactions.get`                                                   | `otp_expired`: the first confirm may have succeeded                                                          |
| `holds.create`                                                         | `holds.get({ externalId })` ([holds.md](holds.md#recovery))          | `external_id_already_exists`: the hold exists, possibly already released                                     |
| `holds.capture`                                                        | `holds.get`: `captured`, and `amountTiyin` is the captured amount    | `transaction_not_available_for_payment`: already captured or released; `hold_time_expired`: the hold ran out |
| `holds.release`                                                        | `holds.get`: `released`                                              | `hold_not_found`: already released, captured, or expired; nothing left to release, by the SDK's assumption   |
| `splits.create`                                                        | `splits.get`                                                         | `split_already_done`                                                                                         |
| `subMerchants.create`                                                  | None exists: repeat with the same data                               | `sub_merchant_already_created`: it exists                                                                    |
| `fiscalization.registerReceipt`, `fiscalization.attachReceipt`         | `fiscalization.getReceipt`: `null` means nothing is registered yet   | `ofd_check_already_generated`                                                                                |
| `fiscalization.refundReceipt`                                          | `fiscalization.getReceipt({ externalId, isRefund: true })`           | None known                                                                                                   |
| `cards.confirmPanBinding`                                              | `cards.get`                                                          | `card_is_already_activated`: done                                                                            |
| `PaylovOnboarding.complete`                                            | `PaylovOnboarding.checkToken`: `true` means `complete` can run again | None: on `false`, ask Paylov to reissue the credentials                                                      |
| `payments.create`, `payments.startPanPayment`, `cards.startPanBinding` | Nothing: call again                                                  | None: an unpaid record or a sent OTP moves no money                                                          |
