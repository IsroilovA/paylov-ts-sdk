/**
 * The gateway simulator as a standalone HTTP server, so several processes share one persistent
 * simulation through `baseUrl`. It answers what `PaylovFakeGateway({ simulate: true })` answers
 * unscripted, from the same tables.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { CARD_FAKES } from '../cards/fake.js';
import { ENDPOINTS as AUTH_ENDPOINTS } from '../core/auth.js';
import { endpointName } from '../core/endpoint.js';
import { FAKE_AUTH_BODIES } from '../core/fake.js';
import type { Endpoint } from '../core/types.js';
import { FISCALIZATION_FAKES } from '../fiscalization/fake.js';
import { GATEWAY_FAKES } from '../gateway/fake.js';
import { HOLD_FAKES } from '../holds/fake.js';
import { ONBOARDING_FAKES } from '../onboarding/fake.js';
import { PAYMENT_FAKES } from '../payments/fake.js';
import { SPLIT_FAKES } from '../splits/fake.js';
import { SUB_MERCHANT_FAKES } from '../subMerchants/fake.js';
import { TRANSACTION_FAKES } from '../transactions/fake.js';
import {
  errorBody,
  FAKE_FAILURE_STATUS,
  respond,
  UNSIMULATED_CODE,
  unsimulatedAnswer,
  type Answer,
} from './answers.js';
import { readPanCard, type PaylovFakePanCard } from './panCards.js';
import { isRouteOf, parseBody, requestFor } from './requests.js';
import { GatewaySimulation } from './simulation.js';
import { decodeSimulationState, encodeSimulationState } from './simulationState.js';
import {
  readSimulationSettings,
  SIMULATED_ROUTES,
  type PaylovSimulationOptions,
  type SimulatedAnswer,
} from './simulators.js';

/** Request bodies above this are refused unread; no SDK request comes close. */
const MAX_BODY_BYTES = 1_048_576;
const UNREADABLE_CODE = 'fake_unreadable_request';
const NOT_SAVED_CODE = 'fake_state_not_saved';

/** Where the simulator keeps its state between restarts: one JSON text, replaced whole. */
export interface PaylovSimulatorStore {
  /** The text the last `save` stored, or `undefined` before the first. */
  load(): Promise<string | undefined>;
  /** Replaces the stored text; the simulator never runs two saves at once. */
  save(state: string): Promise<void>;
}

/** A certificate and key, in PEM, for a simulator that serves HTTPS itself. */
export interface PaylovSimulatorTls {
  readonly cert: string;
  readonly key: string;
}

/** Options of `startGatewaySimulator`. */
export interface PaylovSimulatorOptions extends PaylovSimulationOptions {
  /** Default `0`: a free port, which `url` reports. */
  readonly port?: number;
  /** Default `'127.0.0.1'`. */
  readonly host?: string;
  /**
   * Serve HTTPS with this certificate, which the client process must trust (for example through
   * `NODE_EXTRA_CA_CERTS`). Without it the simulator serves plain HTTP, for a TLS-terminating
   * proxy in front of it: the SDK accepts only an `https` `baseUrl`.
   */
  readonly tls?: PaylovSimulatorTls;
  /**
   * Persist the state to this JSON file, written atomically after every change and read at start.
   * It holds bound cards, transactions, holds, split shares and receipts. Full card numbers, OTPs
   * and submitted receipt items stay out of the file.
   */
  readonly stateFile?: string;
  /** Persist the state elsewhere; not with `stateFile`. Without either the state lives in memory. */
  readonly store?: PaylovSimulatorStore;
  /** The cards PAN bindings can bind. */
  readonly panCards?: readonly PaylovFakePanCard[];
  /**
   * Called with every request the simulation could not answer as Paylov would, such as an
   * unsimulated state or method, a request it could not read, or a failed save. The text names
   * the method and the reason, never a request value. The SDK hides the reason in its error, so
   * log it here.
   */
  readonly onProblem?: (problem: string) => void;
}

/** A running simulator. */
export interface PaylovSimulator {
  /** `https://<host>:<port>`, or `http://` without `tls`. */
  readonly url: string;
  readonly port: number;
  /** Stops accepting requests, closes open connections and waits for the last save. */
  close(): Promise<void>;
}

/** A JSON file replaced through a temporary sibling, so a crash never leaves half a state. */
function fileStore(path: string): PaylovSimulatorStore {
  const temporary = `${path}.tmp`;
  return {
    load: async () => {
      try {
        return await readFile(path, 'utf8');
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined;
        throw cause;
      }
    },
    save: async (state) => {
      await writeFile(temporary, state, 'utf8');
      await rename(temporary, path);
    },
  };
}

function storeOf(options: PaylovSimulatorOptions): PaylovSimulatorStore | undefined {
  const { stateFile, store } = options;
  if (stateFile !== undefined && store !== undefined) {
    throw new TypeError('pass stateFile or store, not both');
  }
  if (stateFile !== undefined && (typeof stateFile !== 'string' || stateFile === '')) {
    throw new TypeError('stateFile must be a file path');
  }
  return stateFile === undefined ? store : fileStore(stateFile);
}

/** Every route the SDK sends to, so a problem names the route template and never a filled path. */
const SPEC_TABLES: readonly Readonly<Record<string, { readonly endpoint: Endpoint }>>[] = [
  GATEWAY_FAKES,
  CARD_FAKES,
  PAYMENT_FAKES,
  TRANSACTION_FAKES,
  HOLD_FAKES,
  SPLIT_FAKES,
  FISCALIZATION_FAKES,
  SUB_MERCHANT_FAKES,
  ONBOARDING_FAKES,
];
const KNOWN_ENDPOINTS: readonly Endpoint[] = [
  AUTH_ENDPOINTS.token,
  AUTH_ENDPOINTS.revoke,
  ...SPEC_TABLES.flatMap((table) => Object.values(table).map((spec) => spec.endpoint)),
];

interface ReceivedRequest {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}

/** What one request gets, and whether it ran the simulation, which may have changed its state. */
interface Served {
  readonly answer: Answer;
  readonly isSimulated: boolean;
}

function nameOf({ method, url }: ReceivedRequest): string {
  const endpoint = KNOWN_ENDPOINTS.find((known) => isRouteOf(known, method, url.pathname));
  return endpoint === undefined ? `${method} (unknown route)` : endpointName(endpoint);
}

function fakeFailure(code: string, message: string): Answer {
  return respond(FAKE_FAILURE_STATUS, errorBody({ code, message }));
}

/** Answers requests from one simulation, reporting each problem through `onProblem`. */
class SimulatorRouter {
  readonly #simulation: GatewaySimulation;
  readonly #onProblem: (problem: string) => void;

  constructor(simulation: GatewaySimulation, onProblem: (problem: string) => void) {
    this.#simulation = simulation;
    this.#onProblem = onProblem;
  }

  serve(received: ReceivedRequest): Served {
    const { method, url } = received;
    if (isRouteOf(AUTH_ENDPOINTS.token, method, url.pathname)) {
      return { answer: respond(200, FAKE_AUTH_BODIES.token), isSimulated: false };
    }
    if (isRouteOf(AUTH_ENDPOINTS.revoke, method, url.pathname)) {
      return { answer: respond(200, FAKE_AUTH_BODIES.revoke), isSimulated: false };
    }
    let label: string | undefined;
    try {
      for (const route of SIMULATED_ROUTES) {
        const request = requestFor(route.endpoint, route.matches, received);
        if (request === undefined) continue;
        label = route.label;
        const answer = route.read(request);
        return {
          answer: this.#answerOf(route.label, () => answer(this.#simulation)),
          isSimulated: true,
        };
      }
    } catch {
      return { answer: this.#unreadable(received, label), isSimulated: false };
    }
    const endpoint = nameOf(received);
    this.#onProblem(`unsimulated request ${endpoint}`);
    return {
      answer: fakeFailure(UNSIMULATED_CODE, `the simulator does not answer ${endpoint}`),
      isSimulated: false,
    };
  }

  /** The simulation's answer; a simulation or encoder that throws is a fake defect. */
  #answerOf(label: string, simulate: () => SimulatedAnswer): Answer {
    let simulated: SimulatedAnswer;
    try {
      simulated = simulate();
    } catch {
      simulated = { kind: 'unsimulated', reason: 'the simulation or its encoder threw' };
    }
    if (simulated.kind === 'answer') return simulated.answer;
    this.#onProblem(`unsimulated ${label}: ${simulated.reason}`);
    return unsimulatedAnswer(label, simulated.reason);
  }

  #unreadable(received: ReceivedRequest, label: string | undefined): Answer {
    const endpoint = nameOf(received);
    const reader = label === undefined ? 'a request matcher' : `the ${label} request decoder`;
    this.#onProblem(`unreadable request ${endpoint} (${reader} threw)`);
    return fakeFailure(UNREADABLE_CODE, `the simulator cannot read ${endpoint}`);
  }
}

/** The body as text, or `undefined` when it exceeds the limit. */
async function readBody(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) continue;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function write(response: ServerResponse, answer: Answer): void {
  if (answer.kind !== 'respond') {
    response.destroy();
    return;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (answer.retryAfter !== null) headers['retry-after'] = answer.retryAfter;
  response.writeHead(answer.httpStatus, headers);
  response.end(JSON.stringify(answer.body));
}

/** Saves the newest state after each change, one save at a time, skipping unchanged states. */
class StateSaver {
  readonly #store: PaylovSimulatorStore | undefined;
  readonly #simulation: GatewaySimulation;
  #saved: string | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    store: PaylovSimulatorStore | undefined,
    simulation: GatewaySimulation,
    saved: string | undefined,
  ) {
    this.#store = store;
    this.#simulation = simulation;
    this.#saved = saved;
  }

  /** Resolves once a state at least as new as the current one is stored; rejects if that save failed. */
  save(): Promise<void> {
    const store = this.#store;
    if (store === undefined) return Promise.resolve();
    const saving = this.#queue.then(async () => {
      const text = JSON.stringify(encodeSimulationState(this.#simulation.state));
      if (text === this.#saved) return;
      await store.save(text);
      this.#saved = text;
    });
    this.#queue = saving.catch(() => undefined);
    return saving;
  }

  settled(): Promise<void> {
    return this.#queue;
  }
}

async function loadSimulation(
  options: PaylovSimulatorOptions,
  store: PaylovSimulatorStore | undefined,
): Promise<{ simulation: GatewaySimulation; saved: string | undefined }> {
  const settings = readSimulationSettings(options, 'startGatewaySimulator');
  const panCards = (options.panCards ?? []).map(readPanCard);
  const saved = await store?.load();
  const state = saved === undefined ? undefined : decodeSimulationState(JSON.parse(saved));
  const simulation = new GatewaySimulation(settings, state);
  for (const panCard of panCards) simulation.addPanCard(panCard);
  return { simulation, saved };
}

function readNetwork(options: PaylovSimulatorOptions): { port: number; host: string } {
  const { port = 0, host = '127.0.0.1', onProblem } = options;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError('port must be an integer from 0 to 65535');
  }
  if (typeof host !== 'string' || host === '')
    throw new TypeError('host must be a non-empty string');
  if (onProblem !== undefined && typeof onProblem !== 'function') {
    throw new TypeError('onProblem must be a function');
  }
  return { port, host };
}

/**
 * Starts a simulated Paylov gateway that `PaylovClient` reaches through `baseUrl`, so an API and
 * its workers share one simulation. It answers what `PaylovFakeGateway({ simulate: true })`
 * answers without a script, and `fake_unsimulated` (HTTP 501) for every state and method it does
 * not simulate. Token and revoke requests succeed for any credentials. With `stateFile` or
 * `store`, every change is saved before its response is sent, and a restart continues from the
 * saved state; a failed save answers `fake_state_not_saved` (HTTP 501), which the SDK treats as
 * an unknown outcome. Development and test use only: it authenticates nobody.
 *
 * @example
 * import { startGatewaySimulator } from '@isroilov_an/paylov/testing';
 *
 * const simulator = await startGatewaySimulator({
 *   port: 4010,
 *   tls: { cert: await readFile(certFile, 'utf8'), key: await readFile(keyFile, 'utf8') },
 *   stateFile: '.paylov-simulator.json',
 *   refundWindowMinutes: 24 * 60,
 *   panCards: [{ cardNumber: testCardNumber, cardExpiry: testCardExpiry }],
 *   onProblem: (problem) => console.warn(problem),
 * });
 * // PaylovClient({ baseUrl: simulator.url, ... })
 */
export async function startGatewaySimulator(
  options: PaylovSimulatorOptions = {},
): Promise<PaylovSimulator> {
  const { port, host } = readNetwork(options);
  const store = storeOf(options);
  const onProblem = options.onProblem ?? (() => undefined);
  const { simulation, saved } = await loadSimulation(options, store);
  const router = new SimulatorRouter(simulation, onProblem);
  const saver = new StateSaver(store, simulation, saved);

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const body = await readBody(request);
    if (body === undefined) {
      onProblem('unreadable request: the body is over 1 MiB');
      write(response, fakeFailure(UNREADABLE_CODE, 'the request body is too large'));
      return;
    }
    const received: ReceivedRequest = {
      method: request.method ?? 'GET',
      url: new URL(request.url ?? '/', 'https://simulator.invalid'),
      body: parseBody(body),
    };
    const { answer, isSimulated } = router.serve(received);
    if (!isSimulated) {
      write(response, answer);
      return;
    }
    try {
      await saver.save();
      write(response, answer);
    } catch {
      onProblem(`state not saved after ${nameOf(received)}`);
      write(response, fakeFailure(NOT_SAVED_CODE, 'the simulator could not save its state'));
    }
  };
  const listener = (request: IncomingMessage, response: ServerResponse): void => {
    handle(request, response).catch(() => {
      response.destroy();
    });
  };
  const server =
    options.tls === undefined
      ? createHttpServer(listener)
      : createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, listener);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  const scheme = options.tls === undefined ? 'http' : 'https';
  const urlHost = host.includes(':') ? `[${host}]` : host;
  return {
    url: `${scheme}://${urlHost}:${actualPort}`,
    port: actualPort,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
      await saver.settled();
    },
  };
}
