import { describe, expect, it } from 'vitest';

import { readSurfaceTransport } from '../../src/core/config.js';
import type { HttpClientConfig } from '../../src/core/http.js';
import { readConfig } from '../../src/core/params.js';

function noop(): void {
  // A function value for fetch.
}

const BASE_URL = 'https://api.paylov.test';

function transport(value: Record<string, unknown>): HttpClientConfig {
  return readSurfaceTransport(readConfig({ baseUrl: BASE_URL, ...value }, 'PaylovClient config'));
}

describe('readSurfaceTransport', () => {
  it('returns the origin and only the options given', () => {
    expect(transport({})).toEqual({ origin: BASE_URL });
    expect(transport({ timeoutMs: 5, fetch: noop })).toEqual({
      origin: BASE_URL,
      timeoutMs: 5,
      fetch: noop,
    });
  });

  it('reads baseUrl as a bare origin', () => {
    expect(transport({ baseUrl: ' https://API.paylov.test:8443/ ' }).origin).toBe(
      'https://api.paylov.test:8443',
    );
  });

  it('keeps the caller’s logger, so class-based hooks keep their receiver', async () => {
    class CountingLogger {
      count = 0;

      onRequest(): void {
        this.count += 1;
      }
    }
    const logger = new CountingLogger();
    const read = transport({ logger }).logger;
    expect(read).toBe(logger);
    await read?.onRequest?.({ method: 'GET', endpoint: 'GET /merchant/status/', attempt: 1 });
    expect(logger.count).toBe(1);
  });
});
