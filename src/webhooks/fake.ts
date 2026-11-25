/** Wire encoders of webhook events, the inverse of `decoders.ts`, for testing requests. */

import { unixSecondsOf } from '../core/fake.js';
import type { WebhookEvent } from './types.js';

/** The whole-SUM `amount` Paylov sends beside `amount_in_tiyin`: the whole part only. */
function wholeSumPartOf(amountTiyin: number): number {
  return (amountTiyin - (amountTiyin % 100)) / 100;
}

/** The body Paylov would deliver for `event`. */
export function encodeWebhookEvent(event: WebhookEvent): unknown {
  const params = {
    transaction_id: event.transactionId,
    status: 'cancelled',
    account: event.account,
    amount: wholeSumPartOf(event.amountTiyin),
    amount_in_tiyin: event.amountTiyin,
    cancel_time: unixSecondsOf(event.cancelledAt, 'cancelledAt'),
  };
  return { jsonrpc: '2.0', method: event.kind, params };
}
