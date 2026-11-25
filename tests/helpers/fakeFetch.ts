/**
 * Scripted `fetch` stand-in injected through `HttpClientConfig.fetch`. Build one per test:
 * `clearMocks` does not reset its call log.
 */

import { setTimeout as delay } from 'node:timers/promises';

import { onTestFinished } from 'vitest';

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
  /** Holds the answer until the test releases it; the wait aborts with the request signal. */
  gate?: ResponseGate;
  /** Thrown instead of answering, as a pre-response network failure. */
  throw?: unknown;
}

/** A barrier that tells a test when a call reached the fake and lets it choose when to answer. */
interface ResponseGate {
  /** Resolves once the gated call has reached the fake. */
  readonly started: Promise<void>;
  /** Lets the gated call answer. */
  release(): void;
  /** Called by the fake: marks the call started and waits for `release` or the signal. */
  enter(signal: AbortSignal | undefined): Promise<void>;
}

/**
 * Creates a gate for one scripted response.
 *
 * @example
 * const gate = createGate();
 * const pending = http.request(GET_STATUS); // scripted with { ...SUCCESS, gate }
 * await gate.started;
 * gate.release();
 */
export function createGate(): ResponseGate {
  const started = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  return {
    started: started.promise,
    release: () => {
      released.resolve(undefined);
    },
    enter: async (signal) => {
      started.resolve(undefined);
      if (signal === undefined) {
        await released.promise;
        return;
      }
      signal.throwIfAborted();
      const aborted = Promise.withResolvers<never>();
      const onAbort = (): void => {
        aborted.reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await Promise.race([released.promise, aborted.promise]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
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
 * Creates a `fetch` that answers from a script and records every call. Call it inside a test: a
 * call past the end of the script fails that test even when the SDK turns the fake's throw into a
 * network error.
 *
 * @example
 * const fetchImpl = createFakeFetch([{ status: 500 }, { body: { result: { ok: true } } }]);
 * const http = createHttpClient({ origin: 'https://api.test', fetch: fetchImpl });
 * await http.request({ method: 'GET', route: '/merchant/status/', shape: 'envelope', effect: 'read' });
 * expect(fetchImpl.calls).toHaveLength(2);
 */
export function createFakeFetch(script: FakeResponseSpec[]): FetchLike & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let overrun: Error | undefined;
  onTestFinished(() => {
    if (overrun !== undefined) throw overrun;
  });

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
      overrun ??= new Error(`createFakeFetch: no scripted response for call #${index + 1}`);
      throw overrun;
    }

    await spec.gate?.enter(init.signal ?? undefined);
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
