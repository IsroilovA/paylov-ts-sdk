/**
 * Caller-input parsing. Malformed values become SDK input errors before any I/O; messages name
 * the method and field, never the value, because values carry credentials, card data and
 * personal data. Exceptions thrown by caller getters or proxies propagate unchanged.
 */

import { invalidAmount, invalidInput, PaylovInputError, type PaylovInputRule } from './errors.js';
import { isRecord, toJsonObject } from './decoding.js';
import { readTiyin, tiyinToWireSum } from './money.js';
import type { PaylovJsonObject } from './types.js';

/** `unknown` when `L` lists every member of `T`, else `never`. */
type ListsEvery<T, L extends readonly T[]> = [Exclude<T, L[number]>] extends [never]
  ? unknown
  : never;

/**
 * A closed set for `literal()` that lists every member of the public union `T`, so the two cannot
 * drift: a missing or foreign member fails to compile.
 *
 * @example
 * const ACTIVITY_TYPES = everyLiteral<FiscalActivityType>()([
 *   'individual_entrepreneur',
 *   'self_employed',
 *   'high_income',
 * ]);
 */
export function everyLiteral<T extends string | number>(): <const L extends readonly T[]>(
  values: L & ListsEvery<T, L>,
) => L {
  return (values) => values;
}

/**
 * The path of an https URL as supplied, before normalization can resolve `/merchant/..` or `/.`
 * away. A backslash counts as a separator, as the URL parser reads it.
 */
const SUPPLIED_PATH = /^https:\/\/[^/\\?#]*(?<path>.*)$/isu;

interface IntegerRange {
  readonly min: number;
  readonly max: number;
}

type ParamsErrorCode = 'sdk_invalid_input' | 'sdk_config_error';

/** One method's parameters. Every getter validates the value and returns it. */
export class Params {
  readonly #record: Readonly<Record<string, unknown>>;
  readonly #context: string;
  readonly #code: ParamsErrorCode;
  /** The field path of this object, e.g. `items[0]`; empty at the top level. */
  readonly #path: string;

  constructor(
    record: Readonly<Record<string, unknown>>,
    context: string,
    code: ParamsErrorCode,
    path: string,
  ) {
    this.#record = record;
    this.#context = context;
    this.#code = code;
    this.#path = path;
  }

  /** A non-blank string. */
  string(key: string): string {
    return this.#checkString(key, this.#required(key));
  }

  optionalString(key: string): string | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkString(key, value);
  }

  integer(key: string): number {
    return this.#checkInteger(key, this.#required(key));
  }

  optionalInteger(key: string, range?: IntegerRange): number | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkInteger(key, value, range);
  }

  optionalBoolean(key: string): boolean | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkBoolean(key, value);
  }

  /** A `Date` with a valid time. */
  date(key: string): Date {
    const value = this.#required(key);
    if (!(value instanceof Date)) throw this.#error(key, 'type', 'must be a Date');
    if (!Number.isFinite(value.getTime())) throw this.#error(key, 'format', 'must be a valid Date');
    return value;
  }

  literal<const T extends string | number>(key: string, values: readonly T[]): T {
    return this.#checkLiteral(key, this.#required(key), values);
  }

  /**
   * A bare `https` origin, returned normalized. Credentials, a query, a fragment or a path are
   * checked on the text as given, before normalization.
   */
  httpsOrigin(key: string): string {
    return this.#checkHttpsOrigin(key, this.#required(key));
  }

  /** A JSON snapshot of that field only. */
  json(key: string): PaylovJsonObject {
    return this.#checkJson(key, this.#required(key));
  }

  optionalJson(key: string): PaylovJsonObject | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkJson(key, value);
  }

  array<T>(key: string, item: (params: Params, index: number) => T): readonly T[] {
    return this.#checkArray(key, this.#required(key), item);
  }

  optionalArray<T>(
    key: string,
    item: (params: Params, index: number) => T,
  ): readonly T[] | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkArray(key, value, item);
  }

  /**
   * The object `key` holds, read once, for a result the SDK returned earlier. Decide from this
   * value only, narrowing each field read from it, never from the params again: a getter can
   * answer differently on a second read.
   */
  record(key: string): Readonly<Record<string, unknown>> {
    return this.#checkRecord(key, this.#required(key));
  }

  optionalRecord(key: string): Readonly<Record<string, unknown>> | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkRecord(key, value);
  }

  optionalObject<T>(key: string, read: (params: Params) => T): T | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : read(this.#child(key, value));
  }

  /** Exactly one of `keys` is present (not `undefined`); returns it. */
  exclusive<const K extends string>(keys: readonly K[]): K {
    const present = keys.filter((key) => this.#read(key) !== undefined);
    const [only] = present;
    if (only === undefined || present.length > 1) {
      const scope = this.#path === '' ? this.#context : `${this.#context}: ${this.#path}`;
      throw new PaylovInputError({
        code: this.#code,
        message: `${scope} requires exactly one of ${keys.join(', ')}`,
        field: this.#path === '' ? undefined : this.#path,
        rule: 'exclusive',
      });
    }
    return only;
  }

  /** A tiyin amount; failures are `sdk_invalid_amount`. */
  tiyin(key: string): number {
    const field = this.#field(key);
    return readTiyin(this.#read(key), field, `${this.#context}: ${field}`);
  }

  optionalTiyin(key: string): number | undefined {
    return this.#read(key) === undefined ? undefined : this.tiyin(key);
  }

  /** A tiyin amount for an endpoint that takes whole SUM; returns the SUM to send. */
  tiyinAsWholeSum(key: string): number {
    const sum = tiyinToWireSum(this.tiyin(key));
    if (sum === undefined) {
      const field = this.#field(key);
      throw invalidAmount(
        `${this.#context}: ${field} must be a whole number of SUM (a multiple of 100)`,
        field,
        'format',
      );
    }
    return sum;
  }

  /** The value as given, for rules that live with the caller (functions). */
  raw(key: string): unknown {
    return this.#read(key);
  }

  #field(key: string): string {
    return this.#path === '' ? key : `${this.#path}.${key}`;
  }

  #error(key: string, rule: PaylovInputRule, text: string): PaylovInputError {
    const field = this.#field(key);
    return new PaylovInputError({
      code: this.#code,
      message: `${this.#context}: ${field} ${text}`,
      field,
      rule,
    });
  }

  /** Own properties only: an inherited value is not a parameter the caller passed. */
  #read(key: string): unknown {
    return Object.hasOwn(this.#record, key) ? this.#record[key] : undefined;
  }

  #required(key: string): unknown {
    const value = this.#read(key);
    if (value === undefined) throw this.#error(key, 'required', 'is required');
    return value;
  }

  #checkRecord(key: string, value: unknown): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) throw this.#error(key, 'type', 'must be an object');
    return value;
  }

  #checkString(key: string, value: unknown): string {
    if (typeof value !== 'string') throw this.#error(key, 'type', 'must be a string');
    if (value.trim() === '') throw this.#error(key, 'required', 'must not be blank');
    return value;
  }

  #checkInteger(key: string, value: unknown, range?: IntegerRange): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw this.#error(key, 'type', 'must be a safe integer');
    }
    if (range !== undefined && (value < range.min || value > range.max)) {
      throw this.#error(key, 'range', `must be between ${range.min} and ${range.max}`);
    }
    return value;
  }

  #checkBoolean(key: string, value: unknown): boolean {
    if (typeof value !== 'boolean') throw this.#error(key, 'type', 'must be a boolean');
    return value;
  }

  #checkLiteral<const T extends string | number>(
    key: string,
    value: unknown,
    values: readonly T[],
  ): T {
    const match = values.find((candidate) => candidate === value);
    if (match === undefined) {
      throw this.#error(key, 'format', `must be one of ${values.map(String).join(', ')}`);
    }
    return match;
  }

  #checkHttpsOrigin(key: string, value: unknown): string {
    const text = this.#checkString(key, value).trim();
    const url = URL.parse(text);
    if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      throw this.#error(key, 'format', 'must be an absolute https URL');
    }
    if (url.protocol !== 'https:') throw this.#error(key, 'format', 'must use https');
    if (url.username !== '' || url.password !== '' || /[?#]/.test(text)) {
      throw this.#error(key, 'format', 'must not include credentials, a query or a fragment');
    }
    const path = SUPPLIED_PATH.exec(text)?.groups?.['path'];
    if (path !== '' && path !== '/') {
      throw this.#error(key, 'format', 'must be an origin without a path');
    }
    return url.origin;
  }

  /** Copied value by value, never serialized, so nothing the caller passed changes silently. */
  #checkJson(key: string, value: unknown): PaylovJsonObject {
    if (!isRecord(value)) throw this.#error(key, 'type', 'must be a JSON object');
    const json = toJsonObject(value);
    if (json === undefined) {
      throw this.#error(
        key,
        'type',
        'must hold only plain objects, arrays, strings, finite numbers, booleans and null',
      );
    }
    return json;
  }

  #checkArray<T>(
    key: string,
    value: unknown,
    item: (params: Params, index: number) => T,
  ): readonly T[] {
    if (!Array.isArray(value)) throw this.#error(key, 'type', 'must be an array');
    const items: readonly unknown[] = value;
    // `Array.from` visits holes, so a sparse entry fails the object check like `undefined`.
    return Array.from(items, (element, index) =>
      item(this.#child(`${key}[${index}]`, element), index),
    );
  }

  #child(key: string, value: unknown): Params {
    if (!isRecord(value)) throw this.#error(key, 'type', 'must be an object');
    return new Params(value, this.#context, this.#code, this.#field(key));
  }
}

function readObject(value: unknown, context: string, code: ParamsErrorCode): Params {
  if (!isRecord(value)) {
    const message = `${context} expects an object`;
    throw new PaylovInputError({ code, message, field: undefined, rule: 'type' });
  }
  return new Params(value, context, code, '');
}

/** Method parameters; failures are `sdk_invalid_input` (`sdk_invalid_amount` for amounts). */
export function readParams(value: unknown, method: string): Params {
  return readObject(value, method, 'sdk_invalid_input');
}

/** Constructor configuration; failures are `sdk_config_error`. */
export function readConfig(value: unknown, surface: string): Params {
  return readObject(value, surface, 'sdk_config_error');
}

/** The `signal` of a method's `PaylovCallOptions`; anything but an `AbortSignal` is rejected. */
export function readCallSignal(options: unknown, method: string): AbortSignal | undefined {
  if (options === undefined) return undefined;
  const signal = readParams(options, `${method} options`).raw('signal');
  if (signal === undefined || signal instanceof AbortSignal) return signal;
  throw invalidInput(`${method} options: signal must be an AbortSignal`, 'signal', 'type');
}
