/**
 * Response decoding primitives. A decoder takes the value and the path reported on failure, and
 * throws {@link DecodeFailure}, which only {@link decodePayload} turns into a public error.
 * Rejected values never enter errors: only the path does.
 */

import { malformedResponse } from './errors.js';
import { wireSumToTiyin } from './money.js';
import { isNonNegativeSafeInteger } from './numbers.js';
import {
  fromUnixSeconds,
  parseIsoDateTime,
  parseTashkentDateTime,
  parseUtcDateTime,
} from './time.js';
import type { HttpResponse, PaylovJsonObject, PaylovJsonValue } from './types.js';

export type Decoder<T> = (value: unknown, path: string) => T;

/** A decoded value broke its decoder at `path`. Internal: never surfaced as it is. */
export class DecodeFailure extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`undecodable value at "${path}"`);
    this.path = path;
  }
}

/**
 * Decodes a response payload from `root` (`result` or `body`); a failure becomes
 * `sdk_malformed_response` at its path, with the response's endpoint and status.
 */
export function decodePayload<T>(response: HttpResponse, root: string, decode: Decoder<T>): T {
  try {
    return decode(response.payload, root);
  } catch (error) {
    if (error instanceof DecodeFailure) throw malformedResponse(response.context, error.path);
    throw error;
  }
}

/** Decodes one field of a record, reporting failures at `<path>.<key>`. */
export type FieldReader = <T>(key: string, decode: Decoder<T>) => T;

/** A canonical UUID in either case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deeper JSON is rejected instead of copied: recursion this deep would overflow the stack. */
const MAX_JSON_DEPTH = 64;

/** 4 to 6 leading digits, a `*` mask, the last 4 (docs 6+4, DEV 4+4). */
const MASKED_PAN = /^\d{4,6}\*+\d{4}$/;

/** A non-array object. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Copies a parsed JSON tree into typed JSON values; `undefined` when it holds anything else or
 * nests deeper than 64 levels.
 */
export function toJsonValue(value: unknown, depth = 0): PaylovJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (depth >= MAX_JSON_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const items: PaylovJsonValue[] = [];
    for (const item of value) {
      const json = toJsonValue(item, depth + 1);
      if (json === undefined) return undefined;
      items.push(json);
    }
    return items;
  }
  return isRecord(value) ? toJsonObject(value, depth) : undefined;
}

export function toJsonObject(
  value: Readonly<Record<string, unknown>>,
  depth = 0,
): PaylovJsonObject | undefined {
  const entries: [string, PaylovJsonValue][] = [];
  for (const [key, child] of Object.entries(value)) {
    const json = toJsonValue(child, depth + 1);
    if (json === undefined) return undefined;
    entries.push([key, json]);
  }
  return Object.fromEntries(entries);
}

export function asRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new DecodeFailure(path);
  return value;
}

export function readFields(value: unknown, path: string): FieldReader {
  const record = asRecord(value, path);
  return (key, decode) => decode(record[key], `${path}.${key}`);
}

/** Decodes the single field `key` of a record. */
export function fieldOf<T>(key: string, decode: Decoder<T>): Decoder<T> {
  return (value, path) => readFields(value, path)(key, decode);
}

export function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new DecodeFailure(path);
  return value;
}

export function asNonEmptyString(value: unknown, path: string): string {
  const text = asString(value, path);
  if (text === '') throw new DecodeFailure(path);
  return text;
}

export function asUuid(value: unknown, path: string): string {
  if (!isUuid(value)) throw new DecodeFailure(path);
  return value;
}

export function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new DecodeFailure(path);
  return value;
}

/** A count, an id or a lifetime in seconds. */
export function asNonNegativeInteger(value: unknown, path: string): number {
  if (!isNonNegativeSafeInteger(value)) throw new DecodeFailure(path);
  return value;
}

/** A wire amount already in tiyin. */
export const asTiyin: Decoder<number> = asNonNegativeInteger;

/** A wire amount in whole SUM, as tiyin. */
export function asTiyinFromSum(value: unknown, path: string): number {
  const amountTiyin = wireSumToTiyin(value);
  if (amountTiyin === undefined) throw new DecodeFailure(path);
  return amountTiyin;
}

/** Anything else may be a full PAN, so it is rejected without being retained. */
export function asMaskedPan(value: unknown, path: string): string {
  const pan = asString(value, path);
  if (!MASKED_PAN.test(pan)) throw new DecodeFailure(path);
  return pan;
}

/** One of a closed set of wire values. Response unions stay open: use this for wire literals. */
export function asLiteral<const T extends string | number>(...values: readonly T[]): Decoder<T> {
  return (value, path) => {
    const match = values.find((candidate) => candidate === value);
    if (match === undefined) throw new DecodeFailure(path);
    return match;
  };
}

export function asJsonObject(value: unknown, path: string): PaylovJsonObject {
  const json = toJsonObject(asRecord(value, path));
  if (json === undefined) throw new DecodeFailure(path);
  return json;
}

/** A documented `T | null` field; an absent key is malformed. */
export function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value, path) => (value === null ? null : decode(value, path));
}

/** A field the gateway may omit or null; both read as `null`. */
export function nullish<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value, path) => (value === null || value === undefined ? null : decode(value, path));
}

/** Decodes each item, reporting failures at `<path>[<index>]`. */
export function arrayOf<T>(decodeItem: Decoder<T>): Decoder<readonly T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) throw new DecodeFailure(path);
    return value.map((item: unknown, index) => decodeItem(item, `${path}[${index}]`));
  };
}

function dateDecoder(parse: (value: string) => Date | undefined): Decoder<Date> {
  return (value, path) => {
    const date = parse(asString(value, path));
    if (date === undefined) throw new DecodeFailure(path);
    return date;
  };
}

/** `YYYY-MM-DD HH:mm:ss` in Tashkent time (fixed +05:00). */
export const asTashkentDateTime: Decoder<Date> = dateDecoder(parseTashkentDateTime);
/** `YYYY-MM-DD HH:mm:ss` in UTC. */
export const asUtcDateTime: Decoder<Date> = dateDecoder(parseUtcDateTime);
/** ISO 8601 with an explicit offset. */
export const asIsoDateTime: Decoder<Date> = dateDecoder(parseIsoDateTime);

/** Non-negative integer Unix seconds, as a JSON number. */
export const asUnixDateTime: Decoder<Date> = (value, path) => {
  const date = typeof value === 'number' ? fromUnixSeconds(value) : undefined;
  if (date === undefined) throw new DecodeFailure(path);
  return date;
};
