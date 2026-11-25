import type { PaylovJsonObject, PaylovJsonValue } from '../core/types.js';

/**
 * `transaction.cancel` notification, sent when a transaction is cancelled from the Paylov
 * business panel or by Paylov staff. Acknowledge with any 2xx; the body is ignored. Only a
 * JSON-RPC notification without an `id` and with `status: 'cancelled'` decodes to this event.
 */
export interface TransactionCancelEvent {
  readonly kind: 'transaction.cancel';
  /** Paylov transaction UUID; the dedupe key. */
  readonly transactionId: string;
  readonly account: PaylovJsonObject;
  /** From the integer `amount_in_tiyin`; the whole-SUM `amount` is ignored. */
  readonly amountTiyin: number;
  /** From `cancel_time` (Unix seconds). */
  readonly cancelledAt: Date;
}

/** A decoded, authenticated webhook. */
export type WebhookEvent = TransactionCancelEvent;

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

/** An authenticated event and the credential pair it was sent with. */
export type ReceivedWebhookEvent = WebhookEvent & {
  /**
   * The index in `credentials` of the pair the request authenticated with. Once an old pair stops
   * appearing, remove it from the configuration and from Paylov.
   */
  readonly credentialIndex: number;
};

/** Receiver outcome, discriminated by `kind`. */
export type WebhookOutcome = ReceivedWebhookEvent | InvalidWebhook;

/**
 * Framework-neutral inbound request supplied to `PaylovWebhookReceiver.receive`. Pass a Fetch
 * `Request`'s `method` and `headers`, or a Node `http` request's `method` and `headersDistinct`:
 * Node's `headers` keeps only the first of repeated `Authorization` headers, which hides a repeat
 * the receiver rejects. Read the body first.
 */
export interface WebhookInput {
  /** Incoming HTTP method. Only `POST` is accepted. */
  readonly method: string | undefined;
  /**
   * Fetch `Headers` or a header record whose values are strings or lists of strings; names are
   * matched case-insensitively. A repeated `Authorization` header is `unauthorized`.
   */
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
  /**
   * The body as read: JSON text, UTF-8 JSON bytes, or the JSON value a body parser produced. A
   * stream, `Blob` or other object is answered `malformed_body`.
   */
  readonly body: string | Uint8Array | ArrayBuffer | PaylovJsonValue;
}

/** One HTTP Basic credential pair registered with Paylov for webhooks. */
export interface PaylovWebhookCredentials {
  /** Basic auth login; it cannot contain `:`. */
  readonly login: string;
  /** Basic auth password. */
  readonly password: string;
}

/** Configuration for `PaylovWebhookReceiver`. */
export interface PaylovWebhookReceiverConfig {
  /**
   * Every pair the receiver accepts, at least one. List the new pair beside the old one while
   * Paylov switches over, then remove the old one: rotation without downtime.
   */
  readonly credentials: readonly [PaylovWebhookCredentials, ...PaylovWebhookCredentials[]];
}
