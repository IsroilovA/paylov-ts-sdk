/**
 * The plumbing every endpoint method shares: read the call's input, send to a declared endpoint,
 * decode, and map the endpoint's miss code to a value.
 */

import { decodePayload, type Decoder } from './decoding.js';
import type { PaylovKnownErrorCode } from './errorCodes.js';
import { isPaylovApiError } from './errors.js';
import { readCallSignal, readParams, type Params } from './params.js';
import type { Endpoint, HttpClient, RequestOptions } from './types.js';

interface CallInput {
  readonly input: Params;
  readonly signal: AbortSignal | undefined;
}

/**
 * A method's parameters and the signal of its call options, both validated before any I/O.
 *
 * @example
 * const method = 'holds.release';
 * const { input, signal } = readCall(params, options, method);
 */
export function readCall(params: unknown, options: unknown, method: string): CallInput {
  return { input: readParams(params, method), signal: readCallSignal(options, method) };
}

/** The `{name}` placeholders of a path template. */
type PathParams<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PathParams<Rest>
  : never;

/**
 * The identifier values a route template needs; a static route takes none. Name each
 * placeholder after the SDK parameter: encoding failures name it.
 */
type PathValues<Route extends string> = [PathParams<Route>] extends [never]
  ? { readonly path?: undefined }
  : { readonly path: Readonly<Record<PathParams<Route>, string>> };

/** What one call adds to its endpoint: values only, never the route, method or shape. */
export type EndpointRequest<E extends Endpoint> = Pick<
  RequestOptions,
  'query' | 'body' | 'signal'
> &
  PathValues<E['route']>;

/**
 * Sends one request to `endpoint` and decodes its payload. Logs and errors carry the route
 * template, never the identifiers. Decode failures are reported under `result` for the enveloped
 * shapes and under `body` for the others.
 *
 * @example
 * return send(http, ENDPOINTS.get, { path: { cardId }, signal }, decodeFetchedCard);
 */
export async function send<E extends Endpoint, T>(
  http: HttpClient,
  endpoint: E,
  request: EndpointRequest<E>,
  decode: Decoder<T>,
): Promise<T> {
  const response = await http.request(endpoint, request);
  return decodePayload(response, endpoint.shape === 'envelope' ? 'result' : 'body', decode);
}

/**
 * Resolves to `fallback` when `call` rejects with the endpoint's `miss` code; every other
 * failure, a decode failure included, propagates.
 *
 * @example
 * return orOnMiss(send(http, ENDPOINTS.get, { query, signal }, decodeHold), ENDPOINTS.get, null);
 */
export async function orOnMiss<T, F>(
  call: Promise<T>,
  endpoint: { readonly miss: PaylovKnownErrorCode },
  fallback: F,
): Promise<T | F> {
  try {
    return await call;
  } catch (error) {
    if (isPaylovApiError(error, endpoint.miss)) return fallback;
    throw error;
  }
}
