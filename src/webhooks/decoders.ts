/** Decoding of authenticated webhook bodies; a decode failure is an outcome, never a throw. */

import {
  asJsonObject,
  asTiyin,
  asUnixDateTime,
  asUuid,
  isRecord,
  DecodeFailure,
  readFields,
} from '../core/decoding.js';
import type { InvalidWebhook, InvalidWebhookReason, WebhookEvent } from './types.js';

/** A decoded body, before the receiver adds the credential pair that authenticated it. */
export type DecodedWebhook = WebhookEvent | InvalidWebhook;

export function invalid(reason: InvalidWebhookReason): InvalidWebhook {
  return { kind: 'invalid', reason };
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

function decodeJsonRpc(envelope: Readonly<Record<string, unknown>>): DecodedWebhook {
  if (envelope['jsonrpc'] !== '2.0') return invalid('invalid_request');
  const params = envelope['params'];
  if (envelope['method'] === 'transaction.cancel') return decodeCancel(params);
  return invalid('unknown_method');
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
    return decodeJsonRpc(envelope);
  } catch (error) {
    if (error instanceof DecodeFailure) return invalid('invalid_params');
    throw error;
  }
}
