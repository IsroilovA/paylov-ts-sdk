/**
 * Scripted `fetch` stand-in injected through `HttpClientConfig.fetch`. Build one per test:
 * `clearMocks` does not reset its call log.
 */

import { setTimeout as delay } from 'node:timers/promises';

import type { FetchLike } from '../../src/core/types.js';

/** One recorded outgoing call. `body` is the parsed JSON when the request sent JSON. */
export interface FakeCall {
  url: string;
  method: string;
  /** Lowercased header names, exactly as the transport produced them. */
  headers: Record<string, string>;
  body: unknown;
  /** The signal the transport passed, so timeout tests can assert it fired. */
  signal: AbortSignal | undefined;
}

/** What the fake should answer with. */
export interface FakeResponseSpec {
  status?: number;
  /** JSON-serialized into the response body. */
  body?: unknown;
  /** Raw body for non-JSON payloads, used verbatim; wins over `body`. */
  rawBody?: string;
  headers?: Record<string, string>;
  /** Abortable delay before answering. */
  delayMs?: number;
  /** Thrown instead of answering, as a pre-response network failure. */
  throw?: unknown;
}

function headersToRecord(init: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (init === undefined) return out;
  new Headers(init).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Creates a `fetch` that answers from a script and records every call.
 *
 * @example
 * const fetchImpl = createFakeFetch([{ status: 500 }, { body: { result: { ok: true } } }]);
 * const http = createHttpClient({ origin: 'https://api.test', fetch: fetchImpl });
 * await http.request({ method: 'GET', path: '/merchant/status/', shape: 'envelope' });
 * expect(fetchImpl.calls).toHaveLength(2);
 */
export function createFakeFetch(script: FakeResponseSpec[]): FetchLike & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];

  const impl = async (input: string, init: RequestInit): Promise<Response> => {
    const index = calls.length;
    const call: FakeCall = {
      url: input,
      method: init.method ?? 'GET',
      headers: headersToRecord(init.headers),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      signal: init.signal ?? undefined,
    };
    calls.push(call);

    const spec = script[index];
    if (spec === undefined) {
      throw new Error(`createFakeFetch: no scripted response for call #${index + 1}`);
    }

    if (spec.delayMs !== undefined) {
      await delay(spec.delayMs, undefined, { signal: init.signal ?? undefined });
    }
    if (spec.throw !== undefined) throw spec.throw as Error;

    const raw = spec.rawBody ?? (spec.body !== undefined ? JSON.stringify(spec.body) : '');
    return new Response(raw, {
      status: spec.status ?? 200,
      ...(spec.headers !== undefined ? { headers: spec.headers } : {}),
    });
  };

  return Object.assign(impl, { calls });
}
