/** Decoding of authenticated webhook bodies; a decode failure is an outcome, never a throw. */

import {
  asJsonObject,
  asNonEmptyString,
  asRecord,
  asTiyin,
  asUnixDateTime,
  asUuid,
  fieldOf,
  isRecord,
  DecodeFailure,
  readFields,
  type Decoder,
} from '../core/decoding.js';
import { decodeCheckoutAmount, type CheckoutAmount } from '../shared/checkoutAmount.js';
import type {
  InvalidWebhook,
  InvalidWebhookReason,
  WebhookCallbackId,
  WebhookEvent,
} from './types.js';

/** A decoded body, before the receiver adds the credential pair that authenticated it. */
export type DecodedWebhook = WebhookEvent | InvalidWebhook;

export function invalid(reason: InvalidWebhookReason): InvalidWebhook {
  return { kind: 'invalid', reason };
}

export function isCallbackId(value: unknown): value is WebhookCallbackId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** A parsed JSON object or array, as a body parser builds it; never a stream or class instance. */
function isParsedContainer(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === Array.prototype || prototype === null;
}

/** Throws on anything that is not JSON, including values `JSON.stringify` maps to `undefined`. */
function parseJsonBody(body: unknown): unknown {
  if (typeof body === 'string') return JSON.parse(body);
  if (body instanceof Uint8Array) return parseJsonBytes(body);
  if (body instanceof ArrayBuffer) return parseJsonBytes(new Uint8Array(body));
  // A stream, `Blob` or other object would re-serialize as `{}` and pass for a request.
  if (typeof body === 'object' && body !== null && !isParsedContainer(body)) {
    throw new TypeError('unreadable webhook body');
  }
  // A parsed value is re-serialized so decoding reads a plain snapshot.
  return JSON.parse(JSON.stringify(body));
}

// Check and perform carry `amount_tiyin`; cancel and deposit carry `amount_in_tiyin`. The
// asymmetry is documented, and only the minor-unit field is read: no rounding rule is stated for
// the whole-currency `amount`.
const decodeParamsAmount: Decoder<CheckoutAmount> = (value, path) => {
  const params = asRecord(value, path);
  const amount = decodeCheckoutAmount(params['amount_tiyin'], params['currency']);
  if (amount === undefined) throw new DecodeFailure(path);
  return amount;
};

function decodeCheckOrPerform(
  method: 'transaction.check' | 'transaction.perform',
  id: WebhookCallbackId,
  value: unknown,
): DecodedWebhook {
  const params = readFields(value, 'params');
  const account = params('account', asJsonObject);
  const amount = decodeParamsAmount(value, 'params');
  if (method === 'transaction.check') return { kind: method, id, account, amount };
  return { kind: method, id, transactionId: params('transaction_id', asUuid), account, amount };
}

function decodeCancel(value: unknown): DecodedWebhook {
  const params = readFields(value, 'params');
  return {
    kind: 'transaction.cancel',
    transactionId: params('transaction_id', asUuid),
    account: params('account', asJsonObject),
    amountTiyin: params('amount_in_tiyin', asTiyin),
    cancelledAt: params('cancel_time', asUnixDateTime),
  };
}

function decodeDeposit(value: unknown): DecodedWebhook {
  const params = readFields(value, 'params');
  return {
    kind: 'merchant.deposit',
    depositId: params('id', asUuid),
    // Opaque: the docs example is the numeric string "125".
    merchantId: params('merchant', asNonEmptyString),
    source: params('type', asNonEmptyString),
    amountTiyin: params('amount_in_tiyin', asTiyin),
    createdAt: params('create_time', asUnixDateTime),
  };
}

const JSON_RPC_METHODS = [
  'transaction.check',
  'transaction.perform',
  'transaction.cancel',
  'merchant.deposit',
] as const;

function decodeJsonRpc(envelope: Readonly<Record<string, unknown>>): DecodedWebhook {
  if (envelope['jsonrpc'] !== '2.0') return invalid('invalid_request');
  const method = JSON_RPC_METHODS.find((name) => name === envelope['method']);
  if (method === undefined) return invalid('unknown_method');
  const params = envelope['params'];
  if (method === 'transaction.cancel') return decodeCancel(params);
  if (method === 'merchant.deposit') return decodeDeposit(params);
  if (!isRecord(params)) return invalid('invalid_params');
  const id = envelope['id'];
  if (!isCallbackId(id)) return invalid('invalid_request');
  return decodeCheckOrPerform(method, id, params);
}

// The card itself is unauthenticated processor data; its id is enough to read it through the
// authenticated cards API.
function decodeCardBind(envelope: Readonly<Record<string, unknown>>): DecodedWebhook {
  const field = readFields(envelope, 'body');
  return {
    kind: 'card.bind',
    token: field('token', asNonEmptyString),
    userId: field('userId', asNonEmptyString),
    status: field('status', asNonEmptyString),
    cardId: field('card', fieldOf('cardId', asUuid)),
  };
}

export function decodeWebhook(body: unknown): DecodedWebhook {
  let envelope: unknown;
  try {
    envelope = parseJsonBody(body);
  } catch {
    return invalid('malformed_body');
  }
  if (!isRecord(envelope)) return invalid('invalid_request');
  // Every field failure, nesting deeper than the JSON copy allows included, is `invalid_params`;
  // any other exception is an SDK bug and propagates.
  try {
    if ('jsonrpc' in envelope) return decodeJsonRpc(envelope);
    if ('token' in envelope) return decodeCardBind(envelope);
  } catch (error) {
    if (error instanceof DecodeFailure) return invalid('invalid_params');
    throw error;
  }
  return invalid('invalid_request');
}
