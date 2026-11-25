/**
 * Closed decoders for the few facts a gateway `error` carries beyond its code. `message` is never
 * read: Paylov documents it as display text not to be parsed. Everything in `data` but field names
 * and the card-block delay is discarded: upstream integrations (Didox, WLCM) embed third-party
 * text and values there.
 */

import { isRecord } from './decoding.js';

interface ErrorDetails {
  readonly fields: readonly string[] | undefined;
  readonly retryAfterSeconds: number | undefined;
}

const MAX_FIELDS = 32;
/** Deeper branches are discarded: unbounded recursion over gateway data would overflow the stack. */
const MAX_FIELD_DEPTH = 16;
const FIELD_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const INDEX_SEGMENT = /^\d{1,9}$/;
const RETRY_AFTER_HEADER = /^\d{1,4}$/;
const MAX_RETRY_AFTER_SECONDS = 3600;
const RATE_LIMITED = 429;

/** A numeric key is an array index only below a named key; top level it is a JSON offset. */
function isFieldSegment(key: string, depth: number): boolean {
  return FIELD_SEGMENT.test(key) || (depth > 0 && INDEX_SEGMENT.test(key));
}

/** Flattens the key paths of a validation `data` map, keeping names only. */
function collectFieldPaths(value: unknown, prefix: readonly string[], paths: string[]): void {
  if (paths.length >= MAX_FIELDS || prefix.length > MAX_FIELD_DEPTH) return;
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (isFieldSegment(key, prefix.length)) collectFieldPaths(child, [...prefix, key], paths);
    }
    return;
  }
  if (Array.isArray(value) && value.some(isRecord)) {
    value.forEach((child, index) => {
      if (isRecord(child)) collectFieldPaths(child, [...prefix, String(index)], paths);
    });
    return;
  }
  if (prefix.length > 0 && paths.length < MAX_FIELDS) paths.push(prefix.join('.'));
}

function isFieldPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.split('.').every((segment, depth) => isFieldSegment(segment, depth))
  );
}

/**
 * `validation_error` maps field names to messages; `field_not_valid` and `field_required` name one
 * field as `data.field`. Live, `field_not_valid` also sends the bare name and `field_required`
 * sends no `data` at all.
 */
function decodeFields(code: string, data: unknown): readonly string[] {
  switch (code) {
    case 'validation_error': {
      const paths: string[] = [];
      collectFieldPaths(data, [], paths);
      return paths;
    }
    case 'field_not_valid':
    case 'field_required': {
      const field = isRecord(data) ? data['field'] : data;
      return isFieldPath(field) ? [field] : [];
    }
    default:
      return [];
  }
}

function asRetryDelay(seconds: unknown): number | undefined {
  const isDelay =
    typeof seconds === 'number' &&
    Number.isInteger(seconds) &&
    seconds >= 1 &&
    seconds <= MAX_RETRY_AFTER_SECONDS;
  return isDelay ? seconds : undefined;
}

/** Only the delta-seconds form of `Retry-After`; an HTTP-date reports no delay. */
export function decodeRetryAfterHeader(retryAfter: string | null): number | undefined {
  const header = retryAfter?.trim();
  return header !== undefined && RETRY_AFTER_HEADER.test(header)
    ? asRetryDelay(Number(header))
    : undefined;
}

/** A blocked card reports the rest of its block as `data.sec_to_retry`. */
function decodeCardBlockDelay(data: unknown): number | undefined {
  return asRetryDelay(isRecord(data) ? data['sec_to_retry'] : undefined);
}

/**
 * A 429's `Retry-After` header is the rate limit's own delay, so it takes precedence over a card
 * block in the body; a body delay counts only without a usable header.
 */
function decodeRetryAfter(
  code: string,
  data: unknown,
  httpStatus: number,
  retryAfter: string | null,
): number | undefined {
  const readsHeader = httpStatus === RATE_LIMITED || code === 'rate_limit_exceeded';
  const header = readsHeader ? decodeRetryAfterHeader(retryAfter) : undefined;
  return header ?? (code === 'card_is_blocked' ? decodeCardBlockDelay(data) : undefined);
}

/**
 * The public details of one enveloped gateway error answered with `httpStatus`; absent facts are
 * `undefined`. `retryAfter` is the response's `Retry-After` header, the only header read.
 */
export function decodeErrorDetails(
  code: string,
  error: Readonly<Record<string, unknown>>,
  httpStatus: number,
  retryAfter: string | null,
): ErrorDetails {
  const fields = decodeFields(code, error['data']);
  const retryAfterSeconds = decodeRetryAfter(code, error['data'], httpStatus, retryAfter);
  return { fields: fields.length > 0 ? fields : undefined, retryAfterSeconds };
}
