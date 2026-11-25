/** The scripted in-memory Paylov gateway behind the `@isroilov_an/paylov/testing` entry point. */

import { createCardsFake } from '../cards/fake.js';
import type { CardsResource } from '../cards/resource.js';
import type { PaylovClientConfig } from '../client.js';
import { ENDPOINTS as AUTH_ENDPOINTS } from '../core/auth.js';
import type { Card } from '../cards/types.js';
import { isRecord } from '../core/decoding.js';
import {
  FAKE_AUTH_BODIES,
  type FakeRequest,
  type MethodNameOf,
  type PaylovFakeMethod,
  type PaylovFakeSchedule,
  type PaylovFakeSurface,
  type RequestDecoder,
  type RequestMatcher,
} from '../core/fake.js';
import { endpointName } from '../core/http.js';
import { readParams } from '../core/params.js';
import type { Endpoint, FetchLike } from '../core/types.js';
import { createFiscalizationFake } from '../fiscalization/fake.js';
import type { FiscalizationResource } from '../fiscalization/resource.js';
import { createGatewayFake } from '../gateway/fake.js';
import type { GatewayResource } from '../gateway/resource.js';
import { createHoldsFake, type HoldsFakeSurface } from '../holds/fake.js';
import type { HoldsResource } from '../holds/resource.js';
import type { PaylovOnboarding } from '../onboarding/client.js';
import { createOnboardingFake } from '../onboarding/fake.js';
import type { PaylovOnboardingConfig } from '../onboarding/types.js';
import { createPaymentsFake } from '../payments/fake.js';
import type { PaymentsResource } from '../payments/resource.js';
import { createSplitsFake } from '../splits/fake.js';
import type { SplitsResource } from '../splits/resource.js';
import { createSubMerchantsFake } from '../subMerchants/fake.js';
import type { SubMerchantsResource } from '../subMerchants/resource.js';
import { createTransactionsFake } from '../transactions/fake.js';
import { isClock, systemClock } from '../core/time.js';
import type { TransactionsResource } from '../transactions/resource.js';
import {
  errorBody,
  failureAnswer,
  FAKE_FAILURE_STATUS,
  isRetryableAnswer,
  jsonResponse,
  replyAnswer,
  respond,
  respondWith,
  type Answer,
} from './answers.js';
import { createSimulators, GatewaySimulation, type Simulator } from './simulation.js';
import { FakeTokenEndpoint, type PaylovFakeTokenEndpoint } from './token.js';

const BASE_URL = 'https://gateway.example';
/** Not SDK or gateway codes, so a request the script cannot serve never reads as a real failure. */
const UNSCRIPTED_CODE = 'fake_unscripted';
const UNREADABLE_CODE = 'fake_unreadable_request';
const UNSIMULATED_CODE = 'fake_unsimulated';

/** The client surface behind each scripted namespace. */
interface ScriptedSurfaces {
  readonly gateway: GatewayResource;
  readonly cards: CardsResource;
  readonly payments: PaymentsResource;
  readonly transactions: TransactionsResource;
  readonly holds: HoldsResource;
  readonly splits: SplitsResource;
  readonly fiscalization: FiscalizationResource;
  readonly subMerchants: SubMerchantsResource;
  readonly onboarding: PaylovOnboarding;
}

/** `'<namespace>.<method>'` of every scripted SDK method, such as `'payments.pay'`. */
type ScriptedMethod = {
  [K in keyof ScriptedSurfaces]: MethodNameOf<K, ScriptedSurfaces[K]>;
}[keyof ScriptedSurfaces];

/** One request the fake received. */
export interface PaylovFakeCall {
  /**
   * The SDK method whose scripted answer served the request, such as `'payments.pay'`; `null`
   * for the token and revoke requests the fake answers itself and for requests no scripted
   * answer served.
   */
  readonly method: ScriptedMethod | null;
  /** The route as logger events name it, such as `'GET /merchant/userCard/getCard/{cardId}/'`. */
  readonly endpoint: string;
}

/** Where one SDK method's requests arrive and how the fake records them. */
interface MethodRoute {
  readonly method: ScriptedMethod;
  readonly endpoint: Endpoint;
  readonly matches: RequestMatcher | undefined;
  /** Decodes the request into the method's `requests`; never keeps the raw request. */
  readonly record: (request: FakeRequest) => void;
}

interface ScriptedAnswer {
  readonly route: MethodRoute;
  readonly answer: Answer;
  readonly persist: boolean;
  /** Whether a persistent answer has served a request; one-time answers leave the queue instead. */
  served: boolean;
}

/** A request and the route that serves it: a scripted answer, else the simulation. */
type MatchedRequest = {
  readonly route: MethodRoute;
  readonly request: FakeRequest;
} & (
  | { readonly scripted: ScriptedAnswer; readonly simulator?: undefined }
  | { readonly scripted: undefined; readonly simulator: Simulator }
);

/** Options of `PaylovFakeGateway`. */
export interface PaylovFakeGatewayOptions {
  /**
   * Keep bound cards, payments, transactions and holds in memory, and answer requests that no
   * scripted answer takes from that state. Default `false`: every request must be scripted.
   */
  readonly simulate?: boolean;
  /**
   * The clock of the simulation, also set as `clientConfig.now` so hold deadlines use it.
   * Defaults to the system clock.
   */
  readonly now?: () => Date;
}

/** The simulation clock, failing loudly on a value the wire cannot carry. */
function checkedClock(now: () => Date): () => Date {
  return () => {
    const date: unknown = now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TypeError('PaylovFakeGateway: now() must return a valid Date');
    }
    return date;
  };
}

/** A request the SDK sends after a retryable answer to the same GET is likely its retry. */
interface ServedRequest {
  readonly endpoint: string;
  readonly isRetryable: boolean;
}

const RETRY_HINT =
  'the SDK retries a GET after a network error, a timeout or HTTP 500/502/503/504; script one answer per attempt or a persistent one';

/** The placeholder values of `path` under `route`, or `undefined` when it does not match. */
function routeValues(route: string, path: string): Record<string, string> | undefined {
  const pattern = RegExp.escape(route).replaceAll(/\\\{(\w+)\\\}/g, '(?<$1>[^/]+)');
  const match = new RegExp(`^${pattern}$`).exec(path);
  if (match === null) return undefined;
  return Object.fromEntries(
    Object.entries(match.groups ?? {}).map(([name, value]) => [name, decodeURIComponent(value)]),
  );
}

/** The parsed JSON body; anything else reads as no body, and never reaches an error. */
function parseBody(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** The request as `route` reads it, or `undefined` when its path does not match. */
function requestOf(route: string, url: URL, body: unknown): FakeRequest | undefined {
  const path = routeValues(route, url.pathname);
  if (path === undefined) return undefined;
  return {
    body: readParams(isRecord(body) ? body : {}, 'fake request body'),
    query: readParams(Object.fromEntries(url.searchParams), 'fake request query'),
    path: readParams(path, 'fake request path'),
  };
}

/** The request as `route`'s method reads it, or `undefined` when it is another method's. */
function requestFor(
  route: MethodRoute,
  method: string,
  url: URL,
  body: unknown,
): FakeRequest | undefined {
  const { endpoint, matches } = route;
  const request = endpoint.method === method ? requestOf(endpoint.route, url, body) : undefined;
  return request !== undefined && (matches?.(request) ?? true) ? request : undefined;
}

/**
 * An in-memory Paylov gateway for application tests. Pass `clientConfig` (or `onboardingConfig`)
 * to the SDK, script each expected call through the namespace that
 * mirrors the client, then call `assertDone()`. Answers run through the SDK's real transport and
 * decoders, so retries, the token lifecycle, errors and result types behave as against the
 * gateway. Token and revoke requests are answered automatically. Each method's `requests` holds
 * the params its served requests carried; requests never reach logs or errors.
 *
 * One-time answers are served in the order they were scripted, each to the first request of its
 * method; a persistent answer (`{ persist: true }`) serves every request of its method that no
 * one-time answer takes. Methods that send to the same gateway endpoint are told apart by their
 * request, so each answer reaches only its own method. An unscripted request fails with
 * `PaylovApiError` `fake_unscripted`, and a request the fake cannot read back into its method's
 * params with `fake_unreadable_request`, both at HTTP 501 and reported by `assertDone()`. With
 * `simulate: true`, an unscripted request of a simulated method is answered from the simulation's
 * state instead, or with `fake_unsimulated` for a state it does not cover.
 *
 * @example
 * import { PaylovClient } from '@isroilov_an/paylov';
 * import { PaylovFakeGateway } from '@isroilov_an/paylov/testing';
 *
 * const fake = new PaylovFakeGateway();
 * const paylov = new PaylovClient(fake.clientConfig);
 * fake.payments.create.reply({ transactionId: '00000000-0000-4000-8000-000000000001' });
 * fake.payments.pay.fail('insufficient_funds');
 *
 * await expect(payOrder(paylov, order)).rejects.toMatchObject({ code: 'insufficient_funds' });
 * fake.assertDone();
 */
export class PaylovFakeGateway {
  readonly gateway: PaylovFakeSurface<GatewayResource>;
  readonly cards: PaylovFakeSurface<CardsResource>;
  readonly payments: PaylovFakeSurface<PaymentsResource>;
  readonly transactions: PaylovFakeSurface<TransactionsResource>;
  readonly holds: HoldsFakeSurface;
  readonly splits: PaylovFakeSurface<SplitsResource>;
  readonly fiscalization: PaylovFakeSurface<FiscalizationResource>;
  readonly subMerchants: PaylovFakeSurface<SubMerchantsResource>;
  readonly onboarding: PaylovFakeSurface<PaylovOnboarding>;

  /** The `fetch` that answers from the script; the configurations below already carry it. */
  readonly fetch: FetchLike;
  /** A complete `PaylovClient` configuration with canary credentials; spread it to add options. */
  readonly clientConfig: PaylovClientConfig;
  /** A complete `PaylovOnboarding` configuration. */
  readonly onboardingConfig: PaylovOnboardingConfig;
  /**
   * The token endpoint. Token requests succeed unless a failure is scripted here; revoke requests
   * always succeed.
   */
  readonly token: PaylovFakeTokenEndpoint;

  readonly #token = new FakeTokenEndpoint();
  readonly #routes: MethodRoute[] = [];
  readonly #simulation: GatewaySimulation | undefined;
  readonly #simulators: ReadonlyMap<string, Simulator>;
  readonly #scripted: ScriptedAnswer[] = [];
  readonly #calls: PaylovFakeCall[] = [];
  /** What `assertDone()` reports about requests the script could not serve. */
  readonly #unserved: string[] = [];
  #lastServed: ServedRequest | undefined;

  constructor(options: PaylovFakeGatewayOptions = {}) {
    const { simulate = false, now } = options;
    if (typeof simulate !== 'boolean') throw new TypeError('simulate must be a boolean');
    if (now !== undefined && !isClock(now)) throw new TypeError('now must be a function');
    const clock = checkedClock(now ?? systemClock);
    this.#simulation = simulate ? new GatewaySimulation(clock) : undefined;
    this.#simulators =
      this.#simulation === undefined ? new Map() : createSimulators(this.#simulation);
    this.token = this.#token;
    const script = <T, P>(
      method: ScriptedMethod,
      endpoint: Endpoint,
      encode: (result: T) => unknown,
      decodeRequest: RequestDecoder<P>,
      matches?: RequestMatcher,
    ): PaylovFakeMethod<T, P> => this.#script(method, endpoint, encode, decodeRequest, matches);
    this.gateway = createGatewayFake(script);
    this.cards = createCardsFake(script);
    this.payments = createPaymentsFake(script);
    this.transactions = createTransactionsFake(script);
    this.holds = createHoldsFake(script);
    this.splits = createSplitsFake(script);
    this.fiscalization = createFiscalizationFake(script);
    this.subMerchants = createSubMerchantsFake(script);
    this.onboarding = createOnboardingFake(script);

    this.fetch = (input, init) => this.#answer(input, init);
    this.clientConfig = {
      baseUrl: BASE_URL,
      consumerKey: 'EXAMPLE-FAKE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL',
      consumerSecret: 'EXAMPLE-FAKE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL',
      username: 'EXAMPLE-FAKE-USERNAME-NOT-A-REAL-CREDENTIAL',
      password: 'EXAMPLE-FAKE-PASSWORD-NOT-A-REAL-CREDENTIAL',
      fetch: this.fetch,
      ...(now !== undefined ? { now: clock } : {}),
    };
    this.onboardingConfig = { baseUrl: BASE_URL, fetch: this.fetch };
  }

  /**
   * Every request received so far, in order, token and revoke requests included. Each method's
   * `requests` holds the params of its own requests.
   *
   * @example
   * expect(fake.calls.map((call) => call.method)).toEqual([null, 'payments.create', 'payments.pay']);
   */
  get calls(): readonly PaylovFakeCall[] {
    return [...this.#calls];
  }

  /**
   * Binds a card in the simulation, as a finished PAN binding would: `cards.get`,
   * `cards.list`, payments and holds then find it. Throws `TypeError` without `simulate: true` or
   * for a card id already bound.
   *
   * @example
   * fake.addCard({ ...savedCard, cardId: '00000000-0000-4000-8000-000000000002', userId: 'user-42' });
   */
  addCard(card: Card): void {
    if (this.#simulation === undefined) {
      throw new TypeError(
        'PaylovFakeGateway: addCard() needs new PaylovFakeGateway({ simulate: true })',
      );
    }
    this.#simulation.addCard(card);
  }

  /**
   * Throws when a request arrived unscripted or unreadable, the simulation met a state it does
   * not simulate, or a scripted answer (token answers included) was never served.
   *
   * @example
   * afterEach(() => fake.assertDone());
   */
  assertDone(): void {
    const problems = [
      ...this.#unserved,
      ...this.#scripted.flatMap(({ route, persist, served }) => {
        if (!persist) return [`unserved ${route.method} answer`];
        return served ? [] : [`unserved persistent ${route.method} answer`];
      }),
      ...this.#token.problems(),
    ];
    if (problems.length > 0) throw new Error(`PaylovFakeGateway: ${problems.join('; ')}`);
  }

  #script<T, P>(
    method: ScriptedMethod,
    endpoint: Endpoint,
    encode: (result: T) => unknown,
    decodeRequest: RequestDecoder<P>,
    matches: RequestMatcher | undefined,
  ): PaylovFakeMethod<T, P> {
    const requests: P[] = [];
    const route: MethodRoute = {
      method,
      endpoint,
      matches,
      record: (request) => {
        requests.push(decodeRequest(request));
      },
    };
    this.#routes.push(route);
    const enqueue = (answer: Answer, schedule: PaylovFakeSchedule = {}): void => {
      this.#scripted.push({ route, answer, persist: schedule.persist === true, served: false });
    };
    return {
      requests,
      reply: (result, schedule) => {
        enqueue(replyAnswer(endpoint, encode(result)), schedule);
      },
      fail: (code, failure = {}, schedule) => {
        enqueue(failureAnswer(code, failure), schedule);
      },
      disconnect: (schedule) => {
        enqueue({ kind: 'disconnect' }, schedule);
      },
      hang: (schedule) => {
        enqueue({ kind: 'hang' }, schedule);
      },
    };
  }

  /** The first one-time answer for the request, else its first persistent answer. */
  #scriptedFor(method: string, url: URL, body: unknown): MatchedRequest | undefined {
    const candidates = this.#scripted.flatMap((scripted) => {
      const request = requestFor(scripted.route, method, url, body);
      return request === undefined ? [] : [{ route: scripted.route, request, scripted }];
    });
    return candidates.find(({ scripted }) => !scripted.persist) ?? candidates[0];
  }

  /** The simulated method the request belongs to, when the simulation is on. */
  #simulatedFor(method: string, url: URL, body: unknown): MatchedRequest | undefined {
    for (const route of this.#routes) {
      const simulator = this.#simulators.get(route.method);
      if (simulator === undefined) continue;
      const request = requestFor(route, method, url, body);
      if (request !== undefined) return { route, request, scripted: undefined, simulator };
    }
    return undefined;
  }

  /** Runs the simulation for a request; a state it does not simulate becomes a fake failure. */
  #simulate(route: MethodRoute, request: FakeRequest, simulator: Simulator): Answer {
    const simulated = simulator(request);
    if (simulated.kind === 'answer') return simulated.answer;
    const { reason } = simulated;
    this.#unserved.push(`unsimulated ${route.method}: ${reason}; script this call`);
    const message = `the simulation does not cover ${route.method}: ${reason}`;
    return respond(FAKE_FAILURE_STATUS, errorBody({ code: UNSIMULATED_CODE, message }));
  }

  async #answer(input: string, init: RequestInit): Promise<Response> {
    const method = init.method ?? 'GET';
    const url = new URL(input);
    const endpoint = `${method} ${url.pathname}`;
    const body = parseBody(init.body);
    let found: MatchedRequest | undefined;
    let answer: Answer;
    try {
      found = this.#scriptedFor(method, url, body) ?? this.#simulatedFor(method, url, body);
      if (found === undefined) return await this.#answerUnmatched(method, url.pathname, body);
      found.route.record(found.request);
      answer =
        found.scripted === undefined
          ? this.#simulate(found.route, found.request, found.simulator)
          : found.scripted.answer;
    } catch {
      // A matcher, request decoder or encoder that disagrees with what the SDK sent is a fake
      // defect; a fetch rejection would read as a retried network failure instead.
      return this.#answerUnreadable(endpoint, found?.route.method);
    }
    const { route, scripted } = found;
    if (scripted?.persist === true) scripted.served = true;
    else if (scripted !== undefined) this.#scripted.splice(this.#scripted.indexOf(scripted), 1);
    this.#lastServed = { endpoint, isRetryable: method === 'GET' && isRetryableAnswer(answer) };
    this.#calls.push({ method: route.method, endpoint: endpointName(route.endpoint) });
    return await respondWith(answer, init.signal);
  }

  #answerUnreadable(endpoint: string, method: ScriptedMethod | undefined): Response {
    this.#calls.push({ method: null, endpoint });
    const reader = method === undefined ? 'a request matcher' : `the ${method} request decoder`;
    this.#unserved.push(`unreadable request ${endpoint} (${reader} threw)`);
    const message = `the fake cannot read ${endpoint}`;
    return jsonResponse(FAKE_FAILURE_STATUS, errorBody({ code: UNREADABLE_CODE, message }));
  }

  async #answerUnmatched(method: string, path: string, body: unknown): Promise<Response> {
    const endpoint = `${method} ${path}`;
    this.#calls.push({ method: null, endpoint });
    if (method === AUTH_ENDPOINTS.token.method && path === AUTH_ENDPOINTS.token.route) {
      return await respondWith(this.#token.answer(body), undefined);
    }
    if (method === AUTH_ENDPOINTS.revoke.method && path === AUTH_ENDPOINTS.revoke.route) {
      return jsonResponse(200, FAKE_AUTH_BODIES.revoke);
    }
    const last = this.#lastServed;
    const isRetry = last?.endpoint === endpoint && last.isRetryable;
    const hint = isRetry ? ` (likely a retry: ${RETRY_HINT})` : '';
    this.#unserved.push(`unscripted request ${endpoint}${hint}`);
    const message = `no scripted answer for ${endpoint}`;
    return jsonResponse(FAKE_FAILURE_STATUS, errorBody({ code: UNSCRIPTED_CODE, message }));
  }
}
