/** Constructor configuration shared by the network surfaces: origin, timeout, fetch, logger. */

import { configError } from './errors.js';
import { isRecord } from './decoding.js';
import type { HttpClientConfig } from './http.js';
import type { Params } from './params.js';
import type { FetchLike, PaylovLogger, PaylovTransportConfig } from './types.js';

/** Node timers support at most a signed 32-bit millisecond delay. */
const MAX_TIMEOUT_MS = 2_147_483_647;

function isFetchLike(value: unknown): value is FetchLike {
  return typeof value === 'function';
}

/** The caller's own logger object is kept, so class-based hooks keep their receiver. */
function assertLogger(value: unknown): asserts value is PaylovLogger {
  if (!isRecord(value)) throw configError('logger must be an object', 'logger', 'type');
  for (const name of ['onRequest', 'onResponse']) {
    const hook = value[name];
    if (hook !== undefined && typeof hook !== 'function') {
      throw configError(`logger.${name} must be a function`, `logger.${name}`, 'type');
    }
  }
}

/** `timeoutMs`, `fetch` and `logger` from a configuration; only the options given. */
function readTransportConfig(config: Params): PaylovTransportConfig {
  const timeoutMs = config.optionalInteger('timeoutMs', { min: 1, max: MAX_TIMEOUT_MS });
  const fetch = config.raw('fetch');
  if (fetch !== undefined && !isFetchLike(fetch)) {
    throw configError('fetch must be a function', 'fetch', 'type');
  }
  const logger = config.raw('logger');
  if (logger !== undefined) assertLogger(logger);
  return {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(fetch !== undefined ? { fetch } : {}),
    ...(logger !== undefined ? { logger } : {}),
  };
}

/**
 * A bare `https` origin. Every path starts with `/merchant/`, so a `.../merchant` base would
 * request `/merchant/merchant/...`; every call carries credentials, so cleartext is refused.
 * Credentials, a query or a fragment are checked on the text as given, before normalization.
 */
function readHttpsOrigin(config: Params, key: string): string {
  const text = config.string(key).trim();
  const url = URL.parse(text);
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw configError(`${key} must be an absolute https URL`, key, 'format');
  }
  if (url.protocol !== 'https:') throw configError(`${key} must use https`, key, 'format');
  if (url.username !== '' || url.password !== '' || /[?#]/.test(text)) {
    throw configError(`${key} must not include credentials, a query or a fragment`, key, 'format');
  }
  if (url.pathname !== '/') {
    throw configError(
      `${key} must be an origin without a path, e.g. https://dev.gw.paylov.uz`,
      key,
      'format',
    );
  }
  return url.origin;
}

/** The transport of a network surface: its `baseUrl` origin and its transport options. */
export function readSurfaceTransport(config: Params): HttpClientConfig {
  return { origin: readHttpsOrigin(config, 'baseUrl'), ...readTransportConfig(config) };
}
