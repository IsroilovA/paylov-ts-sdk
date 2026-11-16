import { createHttpClient, type HttpClientConfig } from '../../src/core/http.js';
import type {
  HttpClient,
  PaylovLogger,
  PaylovLoggerRequestEvent,
  PaylovLoggerResponseEvent,
} from '../../src/core/types.js';
import { createFakeFetch, type FakeResponseSpec } from './fakeFetch.js';

export const BASE_URL = 'https://api.paylov.test';

export interface RecordingLogger {
  readonly logger: PaylovLogger;
  readonly requests: PaylovLoggerRequestEvent[];
  readonly responses: PaylovLoggerResponseEvent[];
}

/**
 * A logger that records every event, so tests can assert metadata-only logging.
 *
 * @example
 * const { logger, requests } = recordingLogger();
 * const onboarding = new PaylovOnboarding({ baseUrl: BASE_URL, fetch: fetchImpl, logger });
 */
export function recordingLogger(): RecordingLogger {
  const requests: PaylovLoggerRequestEvent[] = [];
  const responses: PaylovLoggerResponseEvent[] = [];
  const logger: PaylovLogger = {
    onRequest: (event) => {
      requests.push(event);
    },
    onResponse: (event) => {
      responses.push(event);
    },
  };
  return { logger, requests, responses };
}

export interface ResourceHarness<R> {
  readonly resource: R;
  readonly http: HttpClient;
  readonly fetchImpl: ReturnType<typeof createFakeFetch>;
  /** Every logger event, so tests can assert metadata-only logging. */
  readonly requests: PaylovLoggerRequestEvent[];
  readonly responses: PaylovLoggerResponseEvent[];
}

/**
 * A resource over a scripted fetch without authentication, with instant deterministic backoff
 * and a recording logger. Pass `overrides` to replace any transport option.
 *
 * @example
 * const { resource, fetchImpl } = setupResource(createHoldsResource, [
 *   wireResponse('holds/get.hold.wire.json'),
 * ]);
 * await resource.get({ transactionId });
 * expect(fetchImpl.calls[0]?.url).toBe(`${BASE_URL}/merchant/payment/hold/status/?transactionId=…`);
 */
export function setupResource<R>(
  factory: (http: HttpClient) => R,
  script: FakeResponseSpec[],
  overrides: Omit<Partial<HttpClientConfig>, 'origin'> = {},
): ResourceHarness<R> {
  const fetchImpl = createFakeFetch(script);
  const { logger, requests, responses } = recordingLogger();
  const http = createHttpClient({
    origin: BASE_URL,
    fetch: fetchImpl,
    // Backoff is asserted by the transport suite; keep every other test instant.
    sleep: () => Promise.resolve(),
    random: () => 1,
    logger,
    ...overrides,
  });
  return { resource: factory(http), http, fetchImpl, requests, responses };
}
