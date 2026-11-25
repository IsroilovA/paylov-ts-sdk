/** How logs and errors name a declared endpoint. */

import type { Endpoint, ResponseContext } from './types.js';

/** The static identity logs and errors carry, e.g. `"GET /merchant/userCard/getCard/{cardId}/"`. */
export function endpointName(endpoint: Pick<Endpoint, 'method' | 'route'>): string {
  return `${endpoint.method} ${endpoint.route}`;
}

/** What errors built from a response of `endpoint` carry. */
export function responseContext(endpoint: Endpoint, httpStatus: number): ResponseContext {
  return {
    endpoint: endpointName(endpoint),
    httpStatus,
    effect: endpoint.effect,
  };
}
