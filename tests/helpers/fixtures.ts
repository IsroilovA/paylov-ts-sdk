import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FakeResponseSpec } from './fakeFetch.js';

const FIXTURES_ROOT = new URL('../fixtures/', import.meta.url);

/**
 * A redacted live response: the capture number, the HTTP status, the response headers the SDK
 * reads, and the response body.
 */
interface WireFixture {
  readonly capture: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** A `.wire.json` as stored: `headers` is omitted when the SDK reads none of them. */
type RecordedWire = Omit<WireFixture, 'headers'> & { readonly headers?: WireFixture['headers'] };

const WIRE_KEYS: ReadonlySet<string> = new Set(['capture', 'status', 'headers', 'body']);
/** The only response headers the SDK reads, so the only ones a `.wire.json` keeps. */
const WIRE_HEADERS: ReadonlySet<string> = new Set(['retry-after']);
/** Keys of a recording or a pasted capture, which a body-only fixture never has at its top. */
const RECORDING_KEYS = ['capture', 'headers', 'body', 'request', 'response'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWireFixture(fixture: unknown): fixture is RecordedWire {
  if (!isPlainObject(fixture) || !('body' in fixture)) return false;
  const { capture, status, headers = {} } = fixture;
  return (
    Object.keys(fixture).every((key) => WIRE_KEYS.has(key)) &&
    typeof capture === 'string' &&
    /^\d{3,}$/.test(capture) &&
    Number.isInteger(status) &&
    isPlainObject(headers) &&
    Object.entries(headers).every(
      ([name, value]) => WIRE_HEADERS.has(name) && typeof value === 'string',
    )
  );
}

function hasRecordingKeys(fixture: unknown): boolean {
  return isPlainObject(fixture) && RECORDING_KEYS.some((key) => key in fixture);
}

/** What a fixture's provenance suffix requires of it that it lacks, if anything. */
function formatProblem(relativePath: string, fixture: unknown): string | undefined {
  const suffix = /\.(wire|docs|synthesized)\.json$/.exec(relativePath)?.[1];
  if (suffix === undefined) return 'has no .wire, .docs or .synthesized suffix';
  if (suffix === 'wire') {
    return isWireFixture(fixture)
      ? undefined
      : 'must be exactly { capture: "NNN", status, headers?, body }, with only the headers the SDK reads';
  }
  return hasRecordingKeys(fixture) ? 'must hold the body only' : undefined;
}

/**
 * Reads and parses a fixture, relative to `tests/fixtures/`, and checks the format its provenance
 * suffix requires.
 *
 * @example
 * const body = loadFixture<{ transactionId: string }>('transactions/get.withReceipts.docs.json');
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- test fixture seam
export function loadFixture<T = unknown>(relativePath: string): T {
  const file = fileURLToPath(new URL(relativePath, FIXTURES_ROOT));
  const fixture: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const problem = formatProblem(relativePath, fixture);
  if (problem !== undefined) throw new Error(`${relativePath} ${problem}`);
  return fixture as T;
}

/**
 * Reads a `.wire.json` fixture.
 *
 * @example
 * const { status, body } = loadWire('auth/token.rateLimited.wire.json');
 */
export function loadWire(relativePath: string): WireFixture {
  if (!relativePath.endsWith('.wire.json')) throw new Error(`${relativePath} is not a .wire.json`);
  const { headers = {}, ...recorded } = loadFixture<RecordedWire>(relativePath);
  return { ...recorded, headers };
}

/**
 * A scripted fake-fetch answer replaying a `.wire.json` fixture.
 *
 * @example
 * const { resource } = setupResource(createGatewayResource, [wireResponse('gateway/getStatus.ok.wire.json')]);
 */
export function wireResponse(
  relativePath: string,
  overrides: FakeResponseSpec = {},
): FakeResponseSpec {
  const { status, headers, body } = loadWire(relativePath);
  return { status, headers: { ...headers }, body, ...overrides };
}

/**
 * A scripted fake-fetch answer whose body is a `.docs.json` or `.synthesized.json` fixture. Recordings must go through `wireResponse`, which also replays their status.
 *
 * @example
 * const { resource } = setupResource(createFiscalizationResource, [
 *   fixtureResponse('fiscalization/registerReceipt.commitentNotActive.docs.json', { status: 400 }),
 * ]);
 */
export function fixtureResponse(
  relativePath: string,
  overrides: FakeResponseSpec = {},
): FakeResponseSpec {
  if (relativePath.endsWith('.wire.json')) {
    throw new Error(`${relativePath} is a recording; replay it with wireResponse()`);
  }
  return { body: loadFixture(relativePath), ...overrides };
}

/** Keys and array indexes from a fixture body's root down to the record a test patches. */
type BodyPath = readonly (string | number)[];

function replaceAt(
  value: unknown,
  path: BodyPath,
  edit: (record: Record<string, unknown>) => unknown,
): unknown {
  const [key, ...rest] = path;
  if (key === undefined && isPlainObject(value)) return edit({ ...value });
  if (typeof key === 'number' && Array.isArray(value) && key < value.length) {
    return value.map((item: unknown, index) =>
      index === key ? replaceAt(item, rest, edit) : item,
    );
  }
  if (typeof key === 'string' && isPlainObject(value) && key in value) {
    return { ...value, [key]: replaceAt(value[key], rest, edit) };
  }
  throw new Error(`no record at ${JSON.stringify(path)}`);
}

/**
 * A scripted answer replaying a fixture, as `wireResponse` or `fixtureResponse` would, with the
 * record at `path` replaced by what `edit` returns for a copy of it. For malformed-response cases.
 *
 * @example
 * const response = patchedResponse('cards/get.active.wire.json', ['result', 'card'], (card) => ({
 *   ...card,
 *   number: FULL_PAN,
 * }));
 */
export function patchedResponse(
  relativePath: string,
  path: BodyPath,
  edit: (record: Record<string, unknown>) => unknown,
): FakeResponseSpec {
  const response = relativePath.endsWith('.wire.json')
    ? wireResponse(relativePath)
    : fixtureResponse(relativePath);
  return { ...response, body: replaceAt(response.body, path, edit) };
}
