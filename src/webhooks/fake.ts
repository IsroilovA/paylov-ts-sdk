/** Wire encoders of webhook events, the inverse of `decoders.ts`, for testing requests. */

import { unixSecondsOf } from '../core/fake.js';
import { minorUnitsOf } from '../shared/checkoutAmount.js';
import type { TransactionCheckEvent, TransactionPerformEvent, WebhookEvent } from './types.js';

function encodeCheckoutParams(
  event: TransactionCheckEvent | TransactionPerformEvent,
): Readonly<Record<string, unknown>> {
  return {
    account: event.account,
    amount_tiyin: minorUnitsOf(event.amount),
    currency: event.amount.currency,
  };
}

/** The body Paylov would deliver for `event`. */
export function encodeWebhookEvent(event: WebhookEvent): unknown {
  switch (event.kind) {
    case 'transaction.check':
      return {
        jsonrpc: '2.0',
        id: event.id,
        method: event.kind,
        params: encodeCheckoutParams(event),
      };
    case 'transaction.perform': {
      const params = { transaction_id: event.transactionId, ...encodeCheckoutParams(event) };
      return { jsonrpc: '2.0', id: event.id, method: event.kind, params };
    }
    case 'transaction.cancel': {
      const params = {
        transaction_id: event.transactionId,
        account: event.account,
        amount_in_tiyin: event.amountTiyin,
        cancel_time: unixSecondsOf(event.cancelledAt, 'cancelledAt'),
      };
      return { jsonrpc: '2.0', method: event.kind, params };
    }
    case 'merchant.deposit': {
      const params = {
        id: event.depositId,
        merchant: event.merchantId,
        type: event.source,
        amount_in_tiyin: event.amountTiyin,
        create_time: unixSecondsOf(event.createdAt, 'createdAt'),
      };
      return { jsonrpc: '2.0', method: event.kind, params };
    }
    case 'card.bind':
    default:
      return {
        token: event.token,
        userId: event.userId,
        status: event.status,
        card: { cardId: event.cardId },
      };
  }
}
