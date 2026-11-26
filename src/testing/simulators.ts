/**
 * Which SDK methods the simulation answers, and how one simulated answer is encoded. The
 * in-process fake gateway and the simulator server both answer from these tables, so a method is
 * simulated in both or in neither.
 */

import { CARD_FAKES } from '../cards/fake.js';
import type { CardsResource } from '../cards/resource.js';
import type {
  FakeMethodSpec,
  FakeRequest,
  FakeSpecTable,
  IoMethodOf,
  ReplyOf,
  RequestMatcher,
  RequestOf,
} from '../core/fake.js';
import { isNonNegativeSafeInteger } from '../core/numbers.js';
import { isClock, systemClock } from '../core/time.js';
import type { Endpoint } from '../core/types.js';
import { FISCALIZATION_FAKES } from '../fiscalization/fake.js';
import type { FiscalizationResource } from '../fiscalization/resource.js';
import { HOLD_FAKES, type HoldsFakeReplies } from '../holds/fake.js';
import type { HoldsResource } from '../holds/resource.js';
import { PAYMENT_FAKES } from '../payments/fake.js';
import type { PaymentsResource } from '../payments/resource.js';
import { TRANSACTION_FAKES } from '../transactions/fake.js';
import type { TransactionsResource } from '../transactions/resource.js';
import { methodFailureAnswer, successAnswer, type Answer } from './answers.js';
import type { GatewaySimulation, SimulatedOutcome, SimulationSettings } from './simulation.js';

/** Answers the params of one request from the simulation's state. */
export type Simulator<T, P> = (simulation: GatewaySimulation, params: P) => SimulatedOutcome<T>;

/** The simulated methods of surface `R`; a method left out is answered only by a script. */
export type SimulatorTable<R, Replies = unknown> = {
  readonly [K in IoMethodOf<R>]?: Simulator<ReplyOf<R, K, Replies>, RequestOf<R[K]>>;
};

export const CARD_SIMULATORS: SimulatorTable<CardsResource> = {
  startPanBinding: (simulation, params) => simulation.startPanBinding(params),
  confirmPanBinding: (simulation, params) => simulation.confirmPanBinding(params),
  get: (simulation, params) => simulation.getCard(params),
  list: (simulation, params) => simulation.listCards(params),
  delete: (simulation, params) => simulation.deleteCard(params),
};

export const PAYMENT_SIMULATORS: SimulatorTable<PaymentsResource> = {
  create: (simulation, params) => simulation.createPayment(params),
  pay: (simulation, params) => simulation.pay(params),
  refund: (simulation, params) => simulation.refund(params),
};

export const TRANSACTION_SIMULATORS: SimulatorTable<TransactionsResource> = {
  get: (simulation, params) => simulation.getTransaction(params),
  list: (simulation, params) => simulation.listTransactions(params),
};

export const HOLD_SIMULATORS: SimulatorTable<HoldsResource, HoldsFakeReplies> = {
  create: (simulation, params) => simulation.createHold(params),
  capture: (simulation, params) => simulation.capture(params),
  release: (simulation, params) => simulation.release(params),
  get: (simulation, params) => simulation.getHold(params),
};

export const FISCALIZATION_SIMULATORS: SimulatorTable<FiscalizationResource> = {
  registerReceipt: (simulation, params) => simulation.registerReceipt(params),
  getReceipt: (simulation, params) => simulation.getReceipt(params),
  refundReceipt: (simulation, params) => simulation.refundReceipt(params),
};

/** A simulated answer encoded with the method's own spec, or why the simulation has none. */
export type SimulatedAnswer =
  | { readonly kind: 'answer'; readonly answer: Answer }
  | { readonly kind: 'unsimulated'; readonly reason: string };

/** Encodes the simulation's outcome as a scripted answer would be. */
export function simulatedAnswer<T>(
  spec: FakeMethodSpec<T, unknown>,
  outcome: SimulatedOutcome<T>,
): SimulatedAnswer {
  if (outcome.kind === 'result')
    return { kind: 'answer', answer: successAnswer(spec, outcome.value) };
  if (outcome.kind === 'error') {
    return { kind: 'answer', answer: methodFailureAnswer(spec, outcome.code, outcome.failure) };
  }
  return { kind: 'unsimulated', reason: outcome.reason };
}

/** One simulated method with its types erased, for the simulator server. */
export interface SimulatedRoute {
  /** `'<namespace>.<method>'`, such as `'payments.pay'`. */
  readonly label: string;
  readonly endpoint: Endpoint;
  readonly matches: RequestMatcher | undefined;
  /**
   * Decodes the request into the method's params, throwing when it does not read back, and
   * returns the simulation's answer to them; that answer throws only on a fake defect.
   */
  readonly read: (request: FakeRequest) => (simulation: GatewaySimulation) => SimulatedAnswer;
}

function isMethodOf<T extends object>(table: T, key: string): key is keyof T & string {
  return Object.hasOwn(table, key);
}

function routeOf<T, P>(
  label: string,
  spec: FakeMethodSpec<T, P>,
  simulate: Simulator<T, P> | undefined,
): SimulatedRoute[] {
  if (simulate === undefined) return [];
  return [
    {
      label,
      endpoint: spec.endpoint,
      matches: spec.matches,
      read: (request) => {
        const params = spec.decodeRequest(request);
        return (simulation) => simulatedAnswer(spec, simulate(simulation, params));
      },
    },
  ];
}

function routesOf<R, Replies>(
  namespace: string,
  specs: FakeSpecTable<R, Replies>,
  simulators: SimulatorTable<R, Replies>,
): SimulatedRoute[] {
  return Object.keys(specs)
    .filter((key) => isMethodOf(specs, key))
    .flatMap((method) => routeOf(`${namespace}.${method}`, specs[method], simulators[method]));
}

export const SIMULATED_ROUTES: readonly SimulatedRoute[] = [
  ...routesOf('cards', CARD_FAKES, CARD_SIMULATORS),
  ...routesOf('payments', PAYMENT_FAKES, PAYMENT_SIMULATORS),
  ...routesOf('transactions', TRANSACTION_FAKES, TRANSACTION_SIMULATORS),
  ...routesOf('holds', HOLD_FAKES, HOLD_SIMULATORS),
  ...routesOf('fiscalization', FISCALIZATION_FAKES, FISCALIZATION_SIMULATORS),
];

/** The simulation options shared by the fake gateway and the simulator server. */
export interface PaylovSimulationOptions {
  /**
   * The simulation's clock. Defaults to the system clock; pass a controllable one in tests to move
   * through OTP lifetimes, hold expiries and refund windows.
   */
  readonly now?: () => Date;
  /**
   * How long after a saved-card payment the simulation refunds it, in whole minutes, measured
   * between the whole-second times the gateway reports; a later refund answers
   * `transaction_not_available_for_cancel` and the payment stays paid. Paylov agrees the refund
   * cut-off with each merchant, so set yours; unset, every refund of a paid payment answers
   * `fake_unsimulated`. A non-negative safe integer.
   */
  readonly refundWindowMinutes?: number;
  /**
   * How many seconds after the refund of a fiscalized payment its refund receipt shows in
   * `fiscalization.getReceipt` and `transactions.get`. Paylov registers it in the background,
   * seconds to minutes later, so choose; unset, those reads answer `fake_unsimulated`. A
   * non-negative safe integer.
   */
  readonly refundReceiptDelaySeconds?: number;
}

/** The simulation clock, failing loudly on a value the wire cannot carry. */
function checkedClock(now: () => Date, owner: string): () => Date {
  return () => {
    const date: unknown = now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TypeError(`${owner}: now() must return a valid Date`);
    }
    return date;
  };
}

function optionalCount(value: unknown, name: string): number | undefined {
  if (value !== undefined && !isNonNegativeSafeInteger(value)) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

/** Checks the shared options; throws `TypeError` for an invalid one. */
export function readSimulationSettings(
  options: PaylovSimulationOptions,
  owner: string,
): SimulationSettings {
  const { now, refundWindowMinutes, refundReceiptDelaySeconds } = options;
  if (now !== undefined && !isClock(now)) throw new TypeError('now must be a function');
  return {
    now: checkedClock(now ?? systemClock, owner),
    refundWindowMinutes: optionalCount(refundWindowMinutes, 'refundWindowMinutes'),
    refundReceiptDelaySeconds: optionalCount(
      refundReceiptDelaySeconds,
      'refundReceiptDelaySeconds',
    ),
  };
}
