/** How the fake gateway reads a request the SDK sent: route placeholders, query and JSON body. */

import { isRecord } from '../core/decoding.js';
import type { FakeRequest, RequestMatcher } from '../core/fake.js';
import { readParams } from '../core/params.js';
import type { Endpoint } from '../core/types.js';

function routePattern(route: string): RegExp {
  return new RegExp(`^${RegExp.escape(route).replaceAll(/\\\{(\w+)\\\}/g, '(?<$1>[^/]+)')}$`);
}

/** Whether `path` fills `endpoint`'s route template; never decodes a value. */
export function isRouteOf(endpoint: Endpoint, method: string, path: string): boolean {
  return endpoint.method === method && routePattern(endpoint.route).test(path);
}

/** The placeholder values of `path` under `route`, or `undefined` when it does not match. */
function routeValues(route: string, path: string): Record<string, string> | undefined {
  const match = routePattern(route).exec(path);
  if (match === null) return undefined;
  return Object.fromEntries(
    Object.entries(match.groups ?? {}).map(([name, value]) => [name, decodeURIComponent(value)]),
  );
}

/** The parsed JSON body; anything else reads as no body, and never reaches an error. */
export function parseBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The request as the method at `endpoint` reads it, or `undefined` when it is another method's.
 * Throws when a placeholder value or `matches` cannot read the request.
 */
export function requestFor(
  endpoint: Endpoint,
  matches: RequestMatcher | undefined,
  request: {
    readonly method: string;
    readonly url: URL;
    readonly body: unknown;
  },
): FakeRequest | undefined {
  const { method, url, body } = request;
  const path = endpoint.method === method ? routeValues(endpoint.route, url.pathname) : undefined;
  if (path === undefined) return undefined;
  const read: FakeRequest = {
    body: readParams(isRecord(body) ? body : {}, 'fake request body'),
    query: readParams(Object.fromEntries(url.searchParams), 'fake request query'),
    path: readParams(path, 'fake request path'),
  };
  return (matches?.(read) ?? true) ? read : undefined;
}
