/** The scripted in-memory Paylov gateway behind the `@isroilov_an/paylov/testing` entry point. */

import { CARD_FAKES } from '../cards/fake.js';
import type { CardsResource } from '../cards/resource.js';
import type { Card } from '../cards/types.js';
import type { PaylovClientConfig } from '../client.js';
import { ENDPOINTS as AUTH_ENDPOINTS } from '../core/auth.js';
import { endpointName } from '../core/endpoint.js';
import {
  FAKE_AUTH_BODIES,
  type FakeMethodSpec,
  type FakeRequest,
  type FakeSpecTable,
  type IoMethodOf,
  type PaylovFakeMethod,
  type PaylovFakeSurface,
  type RequestMatcher,
} from '../core/fake.js';
import { isTiyin } from '../core/money.js';
import type { Endpoint, FetchLike } from '../core/types.js';
import { FISCALIZATION_FAKES } from '../fiscalization/fake.js';
import type { FiscalizationResource } from '../fiscalization/resource.js';
import { GATEWAY_FAKES } from '../gateway/fake.js';
import type { GatewayResource } from '../gateway/resource.js';
import { HOLD_FAKES, type HoldsFakeReplies } from '../holds/fake.js';
import type { HoldsResource } from '../holds/resource.js';
import type { PaylovOnboarding } from '../onboarding/client.js';
import { ONBOARDING_FAKES } from '../onboarding/fake.js';
import type { PaylovOnboardingConfig } from '../onboarding/types.js';
import { PAYMENT_FAKES } from '../payments/fake.js';
import type { PaymentsResource } from '../payments/resource.js';
import { SPLIT_FAKES } from '../splits/fake.js';
import type { SplitsResource } from '../splits/resource.js';
import { SUB_MERCHANT_FAKES } from '../subMerchants/fake.js';
import type { SubMerchantsResource } from '../subMerchants/resource.js';
import { TRANSACTION_FAKES } from '../transactions/fake.js';
import type { TransactionsResource } from '../transactions/resource.js';
import { AnswerQueue } from './answerQueue.js';
import {
  errorBody,
  FAKE_FAILURE_STATUS,
  isRetryableAnswer,
  jsonResponse,
  methodFailureAnswer,
  respondWith,
  successAnswer,
  unsimulatedAnswer,
  type Answer,
} from './answers.js';
import { readPanCard, type PaylovFakePanCard } from './panCards.js';
import { isRouteOf, parseBody, requestFor } from './requests.js';
import { GatewaySimulation, type SimulatedOutcome } from './simulation.js';
import {
  CARD_SIMULATORS,
  FISCALIZATION_SIMULATORS,
  HOLD_SIMULATORS,
  PAYMENT_SIMULATORS,
  readSimulationSettings,
  simulatedAnswer,
  TRANSACTION_SIMULATORS,
  type PaylovSimulationOptions,
  type Simulator,
  type SimulatorTable,
} from './simulators.js';
import { FakeTokenEndpoint, type PaylovFakeTokenEndpoint } from './token.js';

const BASE_URL = 'https://gateway.example';
/** Not SDK or gateway codes, so a request the script cannot serve never reads as a real failure. */
const UNSCRIPTED_CODE = 'fake_unscripted';
const UNREADABLE_CODE = 'fake_unreadable_request';

/** A request the fake received, before any route read it. */
interface ReceivedRequest {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}

/** Where one SDK method's requests arrive and how the fake reads them. */
interface MethodRoute {
  /** `'<namespace>.<method>'`, such as `'payments.pay'`. */
  readonly label: string;
  readonly endpoint: Endpoint;
  readonly matches: RequestMatcher | undefined;
  readonly isSimulated: boolean;
  /**
   * Decodes the request into the method's params and adds them to its `requests`; never keeps
   * the raw request. Throws when the request does not read back. Returns the simulation's answer
   * to those params, for a simulated method.
   */
  readonly read: (request: FakeRequest) => (() => Answer) | undefined;
}

/** A request read back into a method's params, and the scripted answer it takes, if any. */
type ReadOutcome =
  | { readonly kind: 'unmatched' }
  | { readonly kind: 'unreadable'; readonly route: MethodRoute | undefined }
  | {
      readonly kind: 'read';
      readonly route: MethodRoute;
      readonly answer: () => Answer;
    };

/** Options of `PaylovFakeGateway`. */
export interface PaylovFakeGatewayOptions extends PaylovSimulationOptions {
  /**
   * Keep bound cards, PAN bindings, payments, transactions, holds and fiscal receipts in memory,
   * and answer requests that no scripted answer takes from that state. Default `false`: every
   * request must be scripted, and `refundWindowMinutes` and `refundReceiptDelaySeconds` are
   * refused.
   */
  readonly simulate?: boolean;
}

/** What `addCard` assumes about a card beyond what `cards.get` reports. */
export interface PaylovFakeCardOptions {
  /**
   * The total that simulated pays and holds may take from this card before it approves no more:
   * your test's assumption, not a Paylov rule. Paylov documents no link between a card's reported
   * `balanceTiyin` and whether a charge is approved, so without this every pay and hold on the card
   * answers `fake_unsimulated`; script the approval or decline instead. A non-negative safe
   * integer.
   */
  readonly spendableTiyin?: number;
}

/** A request the SDK sends after a retryable answer to the same GET is likely its retry. */
interface ServedRequest {
  readonly endpoint: string;
  readonly isRetryable: boolean;
}

const RETRY_HINT =
  'the SDK retries a GET after a network error, a timeout or HTTP 500/502/503/504; script one answer per attempt or a persistent one';

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
  /** `create` replies `{ transactionId }`; the SDK adds the capture deadline itself. */
  readonly holds: PaylovFakeSurface<HoldsResource, HoldsFakeReplies>;
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
  readonly #answers = new AnswerQueue<MethodRoute>();
  /** What `assertDone()` reports about requests the script could not serve. */
  readonly #unserved: string[] = [];
  #lastServed: ServedRequest | undefined;

  constructor(options: PaylovFakeGatewayOptions = {}) {
    const { simulate = false, now } = options;
    if (typeof simulate !== 'boolean') throw new TypeError('simulate must be a boolean');
    const settings = readSimulationSettings(options, 'PaylovFakeGateway');
    for (const name of ['refundWindowMinutes', 'refundReceiptDelaySeconds'] as const) {
      if (settings[name] !== undefined && !simulate) {
        throw new TypeError(`${name} needs simulate: true`);
      }
    }
    const clock = settings.now;
    this.#simulation = simulate ? new GatewaySimulation(settings) : undefined;
    this.token = this.#token;

    // Each surface lists its methods once; the spec, label and simulator follow from the key.
    const gateway = this.#surface('gateway', GATEWAY_FAKES);
    this.gateway = {
      getStatus: gateway('getStatus'),
      listBanks: gateway('listBanks'),
    };
    const cards = this.#surface('cards', CARD_FAKES, CARD_SIMULATORS);
    this.cards = {
      startPanBinding: cards('startPanBinding'),
      confirmPanBinding: cards('confirmPanBinding'),
      get: cards('get'),
      list: cards('list'),
      delete: cards('delete'),
      checkPhone: cards('checkPhone'),
    };
    const payments = this.#surface('payments', PAYMENT_FAKES, PAYMENT_SIMULATORS);
    this.payments = {
      create: payments('create'),
      pay: payments('pay'),
      refund: payments('refund'),
      startPanPayment: payments('startPanPayment'),
      confirmPanPayment: payments('confirmPanPayment'),
    };
    const transactions = this.#surface('transactions', TRANSACTION_FAKES, TRANSACTION_SIMULATORS);
    this.transactions = {
      get: transactions('get'),
      list: transactions('list'),
      getRrn: transactions('getRrn'),
    };
    const holds = this.#surface('holds', HOLD_FAKES, HOLD_SIMULATORS);
    this.holds = {
      create: holds('create'),
      capture: holds('capture'),
      release: holds('release'),
      get: holds('get'),
    };
    const splits = this.#surface('splits', SPLIT_FAKES);
    this.splits = {
      create: splits('create'),
      resendReceipt: splits('resendReceipt'),
      get: splits('get'),
    };
    const fiscalization = this.#surface(
      'fiscalization',
      FISCALIZATION_FAKES,
      FISCALIZATION_SIMULATORS,
    );
    this.fiscalization = {
      registerReceipt: fiscalization('registerReceipt'),
      getReceipt: fiscalization('getReceipt'),
      refundReceipt: fiscalization('refundReceipt'),
      checkActivityType: fiscalization('checkActivityType'),
    };
    const subMerchants = this.#surface('subMerchants', SUB_MERCHANT_FAKES);
    this.subMerchants = { create: subMerchants('create') };
    const onboarding = this.#surface('onboarding', ONBOARDING_FAKES);
    this.onboarding = {
      checkToken: onboarding('checkToken'),
      complete: onboarding('complete'),
    };

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
   * Binds a card in the simulation, as a finished PAN binding would: `cards.get`, `cards.list`,
   * payments and holds then find it, and pays and holds approve up to `spendableTiyin` in total.
   * A card the simulation deleted stays deleted: bind a new card with a fresh `cardId`. Throws
   * `TypeError` without `simulate: true`, for a card id already bound or deleted, or for an
   * invalid `spendableTiyin`.
   *
   * @example
   * fake.addCard(
   *   { ...savedCard, cardId: '00000000-0000-4000-8000-000000000002', userId: 'user-42' },
   *   { spendableTiyin: 10_000_000 },
   * );
   */
  addCard(card: Card, options: PaylovFakeCardOptions = {}): void {
    if (this.#simulation === undefined) {
      throw new TypeError(
        'PaylovFakeGateway: addCard() needs new PaylovFakeGateway({ simulate: true })',
      );
    }
    const { spendableTiyin } = options;
    if (spendableTiyin !== undefined && !isTiyin(spendableTiyin)) {
      throw new TypeError('spendableTiyin must be a non-negative safe integer');
    }
    this.#simulation.addCard(card, spendableTiyin);
  }

  /**
   * Lets the simulated processing center know a card, so `cards.startPanBinding` with its number
   * and expiry and `cards.confirmPanBinding` with its OTP (default {@link PAYLOV_FAKE_OTP}) bind
   * it; payments and holds then approve up to its `spendableTiyin` in total. Throws `TypeError`
   * without `simulate: true`, for an invalid card, or for a card whose masked number another card
   * already has.
   *
   * @example
   * fake.addPanCard({ cardNumber: testCardNumber, cardExpiry: '3012', phoneNumber: testPhone });
   */
  addPanCard(card: PaylovFakePanCard): void {
    if (this.#simulation === undefined) {
      throw new TypeError(
        'PaylovFakeGateway: addPanCard() needs new PaylovFakeGateway({ simulate: true })',
      );
    }
    this.#simulation.addPanCard(readPanCard(card));
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
      ...this.#answers.problems((route) => route.label),
      ...this.#token.problems(),
    ];
    if (problems.length > 0) throw new Error(`PaylovFakeGateway: ${problems.join('; ')}`);
  }

  /** Scripts the methods of `namespace` from its spec table, one key at a time. */
  #surface<R, Replies>(
    namespace: string,
    table: FakeSpecTable<R, Replies>,
    simulators: SimulatorTable<R, Replies> = {},
  ) {
    return <K extends IoMethodOf<R> & string>(method: K): PaylovFakeSurface<R, Replies>[K] =>
      this.#script(`${namespace}.${method}`, table[method], simulators[method]);
  }

  #script<T, P>(
    label: string,
    spec: FakeMethodSpec<T, P>,
    simulate: Simulator<T, P> | undefined,
  ): PaylovFakeMethod<T, P> {
    const { endpoint } = spec;
    const requests: P[] = [];
    const simulation = this.#simulation;
    const simulated =
      simulation === undefined || simulate === undefined
        ? undefined
        : (params: P) => this.#simulatedAnswer(label, spec, simulate(simulation, params));
    const route: MethodRoute = {
      label,
      endpoint,
      matches: spec.matches,
      isSimulated: simulated !== undefined,
      read: (request) => {
        const params = spec.decodeRequest(request);
        requests.push(params);
        return simulated === undefined ? undefined : () => simulated(params);
      },
    };
    this.#routes.push(route);
    return {
      requests,
      reply: (result, schedule) => {
        this.#answers.add(route, successAnswer(spec, result), schedule);
      },
      fail: (code, details = {}, schedule) => {
        this.#answers.add(route, methodFailureAnswer(spec, code, details), schedule);
      },
      disconnect: (schedule) => {
        this.#answers.add(route, { kind: 'disconnect' }, schedule);
      },
      hang: (schedule) => {
        this.#answers.add(route, { kind: 'hang' }, schedule);
      },
    };
  }

  /**
   * Reads the request with the route of its first scripted answer, else of its simulated method.
   * A matcher or request decoder that disagrees with what the SDK sent is a fake defect.
   */
  #read(received: ReceivedRequest): ReadOutcome {
    let route: MethodRoute | undefined;
    try {
      const found = this.#answers.find((candidate) =>
        requestFor(candidate.endpoint, candidate.matches, received),
      );
      if (found !== undefined) {
        route = found.queued.key;
        route.read(found.match);
        return {
          kind: 'read',
          route,
          answer: () => this.#answers.serve(found),
        };
      }
      for (const candidate of this.#routes) {
        if (!candidate.isSimulated) continue;
        const request = requestFor(candidate.endpoint, candidate.matches, received);
        if (request === undefined) continue;
        route = candidate;
        const simulate = candidate.read(request);
        if (simulate !== undefined) return { kind: 'read', route, answer: simulate };
      }
      return { kind: 'unmatched' };
    } catch {
      return { kind: 'unreadable', route };
    }
  }

  /** The route template a request fills, never its path values. */
  #nameOf({ method, url }: ReceivedRequest): string {
    const route = this.#routes.find(({ endpoint }) => isRouteOf(endpoint, method, url.pathname));
    return route === undefined ? `${method} (unknown route)` : endpointName(route.endpoint);
  }

  async #answer(input: string, init: RequestInit): Promise<Response> {
    const received: ReceivedRequest = {
      method: init.method ?? 'GET',
      url: new URL(input),
      body: parseBody(init.body),
    };
    const read = this.#read(received);
    if (read.kind === 'unmatched') return await this.#answerUnmatched(received);
    const endpoint = this.#nameOf(received);
    if (read.kind === 'unreadable') return this.#answerUnreadable(endpoint, read.route);
    const answer = this.#produce(read.route, read.answer);
    const isRetryable = received.method === 'GET' && isRetryableAnswer(answer);
    this.#lastServed = { endpoint, isRetryable };
    return await respondWith(answer, init.signal);
  }

  /** The scripted or simulated answer; a simulation or encoder that throws is a fake defect. */
  #produce(route: MethodRoute, answer: () => Answer): Answer {
    try {
      return answer();
    } catch {
      return this.#unsimulated(route.label, 'the simulation or its encoder threw');
    }
  }

  /** The simulation's outcome encoded with the method's own spec, as a scripted answer would be. */
  #simulatedAnswer<T>(
    label: string,
    spec: FakeMethodSpec<T, unknown>,
    outcome: SimulatedOutcome<T>,
  ): Answer {
    const simulated = simulatedAnswer(spec, outcome);
    return simulated.kind === 'answer'
      ? simulated.answer
      : this.#unsimulated(label, simulated.reason);
  }

  #unsimulated(label: string, reason: string): Answer {
    this.#unserved.push(`unsimulated ${label}: ${reason}; script this call`);
    return unsimulatedAnswer(label, reason);
  }

  #answerUnreadable(endpoint: string, route: MethodRoute | undefined): Response {
    const reader = route === undefined ? 'a request matcher' : `the ${route.label} request decoder`;
    this.#unserved.push(`unreadable request ${endpoint} (${reader} threw)`);
    const message = `the fake cannot read ${endpoint}`;
    return jsonResponse(FAKE_FAILURE_STATUS, errorBody({ code: UNREADABLE_CODE, message }));
  }

  async #answerUnmatched(received: ReceivedRequest): Promise<Response> {
    const { method, url, body } = received;
    if (isRouteOf(AUTH_ENDPOINTS.token, method, url.pathname)) {
      return await respondWith(this.#token.answer(body), undefined);
    }
    if (isRouteOf(AUTH_ENDPOINTS.revoke, method, url.pathname)) {
      return jsonResponse(200, FAKE_AUTH_BODIES.revoke);
    }
    const endpoint = this.#nameOf(received);
    const last = this.#lastServed;
    const isRetry = last?.endpoint === endpoint && last.isRetryable;
    const hint = isRetry ? ` (likely a retry: ${RETRY_HINT})` : '';
    this.#unserved.push(`unscripted request ${endpoint}${hint}`);
    const message = `no scripted answer for ${endpoint}`;
    return jsonResponse(FAKE_FAILURE_STATUS, errorBody({ code: UNSCRIPTED_CODE, message }));
  }
}
