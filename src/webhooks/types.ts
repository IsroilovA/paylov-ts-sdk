import type { PaylovJsonObject, PaylovJsonValue } from '../core/types.js';
import type { CheckoutAmount } from '../shared/checkoutAmount.js';

/** JSON-RPC identifier forms accepted and echoed for `transaction.check` / `transaction.perform`. */
export type WebhookCallbackId = string | number;

/** Checkout `transaction.check`: the merchant validates the order before payment. */
export interface TransactionCheckEvent {
  readonly kind: 'transaction.check';
  /** JSON-RPC identifier that `createWebhookResponse` echoes. */
  readonly id: WebhookCallbackId;
  /** Merchant order fields as received. The checkout link is unsigned: match them yourself. */
  readonly account: PaylovJsonObject;
  /**
   * From the integer `amount_tiyin` and `currency`; the whole-currency `amount` is ignored. The
   * link is unsigned: match the currency and the amount against the order.
   */
  readonly amount: CheckoutAmount;
}

/**
 * Checkout `transaction.perform`: the merchant applies the payment and answers `accept`. The SDK
 * assumes only `accept` completes it; Paylov documents no other answer.
 */
export interface TransactionPerformEvent {
  readonly kind: 'transaction.perform';
  /** JSON-RPC identifier that `createWebhookResponse` echoes. */
  readonly id: WebhookCallbackId;
  /** Paylov transaction UUID; the dedupe key. */
  readonly transactionId: string;
  readonly account: PaylovJsonObject;
  /** From the integer `amount_tiyin` and `currency`; re-check it against the order. */
  readonly amount: CheckoutAmount;
}

/**
 * `transaction.cancel` notification, sent when a transaction is cancelled from the Paylov
 * business panel or by Paylov staff. Acknowledge with any 2xx; the body is ignored.
 */
export interface TransactionCancelEvent {
  readonly kind: 'transaction.cancel';
  /** Paylov transaction UUID; the dedupe key. */
  readonly transactionId: string;
  readonly account: PaylovJsonObject;
  /** From the integer `amount_in_tiyin`; the whole-UZS `amount` is ignored. */
  readonly amountTiyin: number;
  /** From `cancel_time` (Unix seconds). */
  readonly cancelledAt: Date;
}

/**
 * `merchant.deposit` notification, sent when an A2C, Paynet or Munis deposit reaches the merchant
 * account. Acknowledge with any 2xx; the body is ignored.
 */
export interface MerchantDepositEvent {
  readonly kind: 'merchant.deposit';
  /** Deposit UUID; the dedupe key. */
  readonly depositId: string;
  /** Paylov's merchant identifier as sent, an opaque string (the docs example is numeric). */
  readonly merchantId: string;
  /** The deposit channel. */
  readonly source: 'a2c' | 'paynet' | 'munis' | (string & {});
  /** From the integer `amount_in_tiyin`. */
  readonly amountTiyin: number;
  /** From `create_time` (Unix seconds). */
  readonly createdAt: Date;
}

/**
 * Card Bind notification. Only the bound card's id is surfaced; read the card itself with
 * `paylov.cards.get({ cardId })`. Paylov never retries this webhook, so a bind session read is
 * the fallback.
 */
export interface CardBindEvent {
  readonly kind: 'card.bind';
  /** Bind-session token; the dedupe key. */
  readonly token: string;
  /** The `userId` the bind link was created for. */
  readonly userId: string;
  /** Documented as always `confirmed`. */
  readonly status: 'confirmed' | (string & {});
  /** The bound card's id (UUID). */
  readonly cardId: string;
}

/** A decoded, authenticated webhook. */
export type WebhookEvent =
  | TransactionCheckEvent
  | TransactionPerformEvent
  | TransactionCancelEvent
  | MerchantDepositEvent
  | CardBindEvent;

/** Locally classified invalid input. Paylov documents no failure response for these. */
export type InvalidWebhookReason =
  | 'unauthorized'
  | 'unsupported_http_method'
  | 'malformed_body'
  | 'invalid_request'
  | 'unknown_method'
  | 'invalid_params';

/** A webhook the receiver could not authenticate or decode. */
export interface InvalidWebhook {
  readonly kind: 'invalid';
  readonly reason: InvalidWebhookReason;
}

/** Receiver outcome, discriminated by `kind`. */
export type WebhookOutcome = WebhookEvent | InvalidWebhook;

/**
 * Framework-neutral inbound request supplied to `PaylovWebhookReceiver.receive`. The `method` and
 * `headers` of a Node `http` request or a Fetch `Request` fit as they are; read the body first.
 */
export interface WebhookInput {
  /** Incoming HTTP method. Only `POST` is accepted. */
  readonly method: string | undefined;
  /** Fetch `Headers` or a Node-style header record; names are matched case-insensitively. */
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
  /**
   * The body as read: JSON text, UTF-8 JSON bytes, or the JSON value a body parser produced. A
   * stream, `Blob` or other object is answered `malformed_body`.
   */
  readonly body: string | Uint8Array | ArrayBuffer | PaylovJsonValue;
}

/** Configuration for `PaylovWebhookReceiver`. */
export interface PaylovWebhookReceiverConfig {
  /** Basic auth login registered with Paylov; it cannot contain `:`. */
  readonly login: string;
  /** Basic auth password registered with Paylov. */
  readonly password: string;
}

/**
 * The merchant's answer to `transaction.check` or `transaction.perform`:
 * - `accept`: status `0`, the order matches (check) or the payment is applied (perform);
 * - `maintenance`: status `3`;
 * - `invalid_amount`: status `5`, the amount or currency does not match the order;
 * - `order_not_found`: status `303`, no order matches the account;
 * - `{ custom }`: status `+1` with your own non-blank reason as `statusText`.
 */
export type WebhookDecision =
  | 'accept'
  | 'maintenance'
  | 'invalid_amount'
  | 'order_not_found'
  | { readonly custom: string };

/** The wire `result.status` of a webhook answer. */
export type WebhookResponseStatus = '0' | '3' | '5' | '303' | '+1';

/** Documented JSON-RPC result body answering `transaction.check` / `transaction.perform`. */
export interface WebhookResponseBody {
  readonly jsonrpc: '2.0';
  readonly id: WebhookCallbackId;
  readonly result: { readonly status: WebhookResponseStatus; readonly statusText: string };
}
