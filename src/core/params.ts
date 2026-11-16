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
 * const DECISIONS = everyLiteral<WebhookDecisionWord>()(['accept', 'maintenance']);
 */
export function everyLiteral<T extends string | number>(): <const L extends readonly T[]>(
  values: L & ListsEvery<T, L>,
) => L {
  return (values) => values;
}

interface IntegerRange {
  readonly min: number;
  readonly max: number;
}

/** One method's parameters. Every getter validates the value and returns it. */
export interface Params {
  /** A non-blank string. */
  string(key: string): string;
  optionalString(key: string): string | undefined;
  integer(key: string): number;
  optionalInteger(key: string, range?: IntegerRange): number | undefined;
  optionalBoolean(key: string): boolean | undefined;
  literal<const T extends string | number>(key: string, values: readonly T[]): T;
  optionalLiteral<const T extends string | number>(
    key: string,
    values: readonly T[],
  ): T | undefined;
  /** An absolute `http(s)` URL. */
  url(key: string): string;
  optionalUrl(key: string): string | undefined;
  /** A JSON snapshot of that field only. */
  json(key: string): PaylovJsonObject;
  optionalJson(key: string): PaylovJsonObject | undefined;
  /** A record of strings whose every key and value matches `pattern`. */
  stringRecord(key: string, pattern: RegExp): Readonly<Record<string, string>>;
  array<T>(key: string, item: (params: Params, index: number) => T): readonly T[];
  optionalArray<T>(
    key: string,
    item: (params: Params, index: number) => T,
  ): readonly T[] | undefined;
  object<T>(key: string, read: (params: Params) => T): T;
  optionalObject<T>(key: string, read: (params: Params) => T): T | undefined;
  /** Exactly one of `keys` is present (not `undefined`); returns it. */
  exclusive<const K extends string>(keys: readonly K[]): K;
  /** A tiyin amount; failures are `sdk_invalid_amount`. */
  tiyin(key: string): number;
  optionalTiyin(key: string): number | undefined;
  /** A tiyin amount for an endpoint that takes whole SUM; returns the SUM to send. */
  tiyinAsWholeSum(key: string): number;
  /** The value as given, for rules that live with the caller (functions). */
  raw(key: string): unknown;
}

type ParamsErrorCode = 'sdk_invalid_input' | 'sdk_config_error';

class ParamsReader implements Params {
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

  literal<const T extends string | number>(key: string, values: readonly T[]): T {
    return this.#checkLiteral(key, this.#required(key), values);
  }

  optionalLiteral<const T extends string | number>(
    key: string,
    values: readonly T[],
  ): T | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkLiteral(key, value, values);
  }

  url(key: string): string {
    return this.#checkUrl(key, this.#required(key));
  }

  optionalUrl(key: string): string | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkUrl(key, value);
  }

  json(key: string): PaylovJsonObject {
    return this.#checkJson(key, this.#required(key));
  }

  optionalJson(key: string): PaylovJsonObject | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : this.#checkJson(key, value);
  }

  stringRecord(key: string, pattern: RegExp): Readonly<Record<string, string>> {
    const value = this.#required(key);
    if (!isRecord(value)) throw this.#error(key, 'type', 'must be an object');
    const checked: [string, string][] = [];
    for (const [name, entry] of Object.entries(value)) {
      if (typeof entry !== 'string') throw this.#error(key, 'type', 'values must be strings');
      if (!(pattern.test(name) && pattern.test(entry))) {
        throw this.#error(key, 'format', 'has a key or value that is not allowed');
      }
      checked.push([name, entry]);
    }
    return Object.fromEntries(checked);
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

  object<T>(key: string, read: (params: Params) => T): T {
    return read(this.#child(key, this.#required(key)));
  }

  optionalObject<T>(key: string, read: (params: Params) => T): T | undefined {
    const value = this.#read(key);
    return value === undefined ? undefined : read(this.#child(key, value));
  }

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

  tiyin(key: string): number {
    const field = this.#field(key);
    return readTiyin(this.#read(key), field, `${this.#context}: ${field}`);
  }

  optionalTiyin(key: string): number | undefined {
    return this.#read(key) === undefined ? undefined : this.tiyin(key);
  }

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

  #checkUrl(key: string, value: unknown): string {
    const text = this.#checkString(key, value);
    const protocol = URL.parse(text)?.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw this.#error(key, 'format', 'must be an absolute http(s) URL');
    }
    return text;
  }

  /** Serializer exceptions are discarded: a cycle or a BigInt says nothing the caller needs. */
  #checkJson(key: string, value: unknown): PaylovJsonObject {
    if (!isRecord(value)) throw this.#error(key, 'type', 'must be a JSON object');
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(JSON.stringify(value));
    } catch {
      throw this.#error(key, 'type', 'must be JSON-serializable');
    }
    const json = isRecord(snapshot) ? toJsonObject(snapshot) : undefined;
    if (json === undefined) throw this.#error(key, 'type', 'must be a JSON object');
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
    return new ParamsReader(value, this.#context, this.#code, this.#field(key));
  }
}

function readObject(value: unknown, context: string, code: ParamsErrorCode): Params {
  if (!isRecord(value)) {
    const message = `${context} expects an object`;
    throw new PaylovInputError({ code, message, field: undefined, rule: 'type' });
  }
  return new ParamsReader(value, context, code, '');
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
