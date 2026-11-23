/**
 * Strict wire timestamp parsers. Each returns `undefined` for a malformed string or an impossible
 * calendar date. Tashkent is a fixed +05:00 offset without DST, so no time-zone database is
 * consulted.
 */

import { configError } from './errors.js';
import { isNonNegativeSafeInteger } from './numbers.js';

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** Tashkent's fixed offset east of UTC. */
export const TASHKENT_OFFSET_MINUTES = 300;
export const MINUTE_MS = 60_000;

type WallClock = readonly [
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
];

/** Capture groups 1–6 as wall-clock components. */
function wallClockOf(match: RegExpExecArray): WallClock {
  const at = (group: number): number => Number(match[group]);
  return [at(1), at(2), at(3), at(4), at(5), at(6)];
}

/**
 * Epoch milliseconds of wall-clock components read as UTC, or `undefined` when they do not
 * round-trip (Feb 30, hour 24, ...). `setUTCFullYear` keeps years below 100 literal.
 */
function wallClockMs(parts: WallClock): number | undefined {
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const actual = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
  return actual.every((value, index) => value === parts[index]) ? date.getTime() : undefined;
}

/** A four-digit year plus an offset of under a day always lies inside the `Date` range. */
function parseLocal(value: string, offsetMinutes: number): Date | undefined {
  const match = LOCAL_DATE_TIME.exec(value);
  const ms = match === null ? undefined : wallClockMs(wallClockOf(match));
  return ms === undefined ? undefined : new Date(ms - offsetMinutes * MINUTE_MS);
}

/** `YYYY-MM-DD HH:mm:ss` in Tashkent time. */
export function parseTashkentDateTime(value: string): Date | undefined {
  return parseLocal(value, TASHKENT_OFFSET_MINUTES);
}

/** `YYYY-MM-DD HH:mm:ss` in UTC. */
export function parseUtcDateTime(value: string): Date | undefined {
  return parseLocal(value, 0);
}

/** Minutes east of UTC for groups 8–10 of an ISO match; `Z` leaves them unset. */
function isoOffsetMinutes(match: RegExpExecArray): number | undefined {
  if (match[8] === undefined) return 0;
  const hours = Number(match[9]);
  const minutes = Number(match[10]);
  if (hours > 23 || minutes > 59) return undefined;
  return (match[8] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

/** ISO 8601 with `Z` or `±HH:MM`; fractions beyond milliseconds are truncated. */
export function parseIsoDateTime(value: string): Date | undefined {
  const match = ISO_DATE_TIME.exec(value);
  if (match === null) return undefined;
  const ms = wallClockMs(wallClockOf(match));
  const offset = isoOffsetMinutes(match);
  if (ms === undefined || offset === undefined) return undefined;
  const fractionMs = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  return new Date(ms + fractionMs - offset * MINUTE_MS);
}

/** Non-negative safe-integer unix seconds inside the `Date` range. */
export function fromUnixSeconds(value: number): Date | undefined {
  if (!isNonNegativeSafeInteger(value)) return undefined;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

/** The current time. Injected through `PaylovClientConfig.now`; defaults to the system clock. */
export type Clock = () => Date;

export function systemClock(): Date {
  return new Date();
}

/** Its results are checked on each read by `readClock`. */
export function isClock(value: unknown): value is Clock {
  return typeof value === 'function';
}

/** The clock's current epoch milliseconds; a clock that returns no valid `Date` is a config bug. */
export function readClock(clock: Clock, method: string): number {
  const now: unknown = clock();
  const ms = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(ms)) {
    throw configError(`${method}: the configured now() must return a valid Date`, 'now', 'type');
  }
  return ms;
}
