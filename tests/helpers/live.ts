/**
 * Gates and plumbing for the opt-in sandbox suite; `docs/runbook.md` owns the procedure. An
 * unset gate or an unreachable gateway is a clean skip with one printed reason, never a failure.
 * Output is labels, statuses, error codes and counts only: never ids, tokens, card data or bodies.
 * Lanes drive the package entry point only, as a consumer would.
 */

import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';

import { expect } from 'vitest';

import {
  PaylovClient,
  isPaylovApiError,
  type PaylovApiError,
  type PaylovClientConfig,
} from '../../src/index.js';

import { env, readSandboxConfig, SANDBOX_HOST } from '../../scripts/sandboxConfig.mjs';

export { env } from '../../scripts/sandboxConfig.mjs';

interface LiveConfig {
  /** Bare origin of the sandbox gateway. */
  readonly baseUrl: string;
  readonly consumerKey: string;
  readonly consumerSecret: string;
  readonly username: string;
  readonly password: string;
  /** `PAYLOV_LIVE_WRITES=1`: lanes that create sandbox state or move sandbox money. */
  readonly writes: boolean;
  /** `PAYLOV_LIVE_REFUND=1` (with writes): lanes that call `payments.refund`. */
  readonly refund: boolean;
  /** `PAYLOV_LIVE_SLOW=1` (with writes): the hold-expiry lane (about 2.5 minutes). */
  readonly slow: boolean;
}

type LiveGate =
  | { readonly enabled: true; readonly config: LiveConfig }
  | { readonly enabled: false; readonly reason: string };

/** Short random tag that keeps this run's user and external ids apart from earlier runs. */
const LIVE_RUN = randomUUID().slice(0, 8);

function flag(name: string): boolean {
  return env(name) === '1';
}

function readConfig(): LiveConfig | string {
  if (!flag('PAYLOV_LIVE')) return 'PAYLOV_LIVE is not 1';
  const config = readSandboxConfig();
  if (typeof config === 'string') return config;
  const writes = flag('PAYLOV_LIVE_WRITES');
  return {
    ...config,
    writes,
    refund: writes && flag('PAYLOV_LIVE_REFUND'),
    slow: writes && flag('PAYLOV_LIVE_SLOW'),
  };
}

function reachable(host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, timeout: timeoutMs });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => {
      done(true);
    });
    socket.once('timeout', () => {
      done(false);
    });
    socket.once('error', () => {
      done(false);
    });
  });
}

/** Writes one line to stdout; the suite's only output channel. */
export function note(line: string): void {
  process.stdout.write(`[paylov live] ${line}\n`);
}

async function resolveGate(): Promise<LiveGate> {
  const config = readConfig();
  if (typeof config === 'string') return { enabled: false, reason: config };
  if (!(await reachable(SANDBOX_HOST, 5_000))) {
    return { enabled: false, reason: `${SANDBOX_HOST}:443 is unreachable from this network` };
  }
  return { enabled: true, config };
}

async function announceGate(): Promise<LiveGate> {
  const gate = await resolveGate();
  if (gate.enabled) {
    const { writes, refund, slow } = gate.config;
    const lanes = Object.entries({ reads: true, writes, refund, slow })
      .filter(([, enabled]) => enabled)
      .map(([lane]) => lane);
    note(`enabled: ${lanes.join(', ')}`);
  } else {
    note(`skipped: ${gate.reason}`);
  }
  return gate;
}

let gatePromise: Promise<LiveGate> | undefined;

/** Resolves the gates once per worker; the live config shares one worker across files. */
export function liveGate(): Promise<LiveGate> {
  gatePromise ??= announceGate();
  return gatePromise;
}

/** Builds a client for these credentials; `overrides` replace single config fields. */
export function newLiveClient(
  config: LiveConfig,
  overrides: Partial<PaylovClientConfig> = {},
): PaylovClient {
  return new PaylovClient({
    baseUrl: config.baseUrl,
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    username: config.username,
    password: config.password,
    ...overrides,
  });
}

let sharedClient: PaylovClient | undefined;

/** One client for every lane, so the run logs in once and stays under the token rate limit. */
export function liveClient(config: LiveConfig): PaylovClient {
  sharedClient ??= newLiveClient(config);
  return sharedClient;
}

/** The merchant user a lane binds its cards for: fresh per run and per lane. */
export function liveUserId(lane: string): string {
  return `sdk-live-${LIVE_RUN}-${lane}`;
}

let externalSeq = 0;

/** A fresh `externalId` for this run: `sdk-live-<run>-<label>-<n>`, well under 64 chars. */
export function externalId(label: string): string {
  externalSeq += 1;
  return `sdk-live-${LIVE_RUN}-${label}-${externalSeq}`;
}

/** Records an observation. Callers pass labels, statuses, codes, counts and booleans only. */
export function observe(
  label: string,
  fields: Readonly<Record<string, string | number | boolean | null>>,
): void {
  note(`${label} ${JSON.stringify(fields)}`);
}

function refusalFields(error: PaylovApiError): Record<string, string | number> {
  return {
    code: error.code,
    httpStatus: error.httpStatus,
  };
}

type Settled<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PaylovApiError };

/**
 * Awaits a call whose outcome is only observed and records it. A gateway refusal becomes data;
 * input, protocol and connection errors still fail the test.
 */
export async function settle<T>(label: string, promise: Promise<T>): Promise<Settled<T>> {
  try {
    const value = await promise;
    observe(label, { ok: true });
    return { ok: true, value };
  } catch (error) {
    if (!isPaylovApiError(error)) throw error;
    observe(label, { ok: false, ...refusalFields(error) });
    return { ok: false, error };
  }
}

interface CleanupStep {
  readonly label: string;
  readonly step: () => Promise<unknown>;
  /** Refusal codes meaning the resource is already gone. */
  readonly goneCodes: readonly string[];
}

/**
 * Sandbox state a lane must remove, registered as soon as the gateway returns its id. `run`
 * attempts every step, newest first, so holds are released before the card that holds them is
 * deleted, then fails naming each step that did not complete; a refusal counts as done only with
 * one of the step's `goneCodes`.
 */
export class LiveCleanup {
  readonly #steps: CleanupStep[] = [];

  add(label: string, step: () => Promise<unknown>, ...goneCodes: string[]): void {
    this.#steps.push({ label, step, goneCodes });
  }

  async run(): Promise<void> {
    const failures: string[] = [];
    for (const { label, step, goneCodes } of this.#steps.splice(0).toReversed()) {
      try {
        const outcome = await settle(label, step());
        if (!outcome.ok && !goneCodes.includes(outcome.error.code)) {
          failures.push(`${label} ${outcome.error.code}`);
        }
      } catch {
        failures.push(`${label} failed`);
      }
    }
    if (failures.length > 0) throw new Error(`live cleanup: ${failures.join(', ')}`);
  }
}

/** Awaits a call the gateway must refuse, records the refusal and returns it. */
export async function refused(label: string, promise: Promise<unknown>): Promise<PaylovApiError> {
  const outcome = await settle(label, promise);
  expect(outcome.ok, `${label}: expected the gateway to refuse the call`).toBe(false);
  if (outcome.ok) throw new Error(`${label}: expected the gateway to refuse the call`);
  return outcome.error;
}

/** How far a decoded timestamp may sit from the local clock; a zone slip is 5 hours. */
const RECENT_MS = 10 * 60 * 1000;

/** Asserts a timestamp of something that just happened, catching a wrong time-zone decode. */
export function expectRecent(label: string, date: Date | null): void {
  expect(date, `${label} is set`).toBeInstanceOf(Date);
  const skewMs = Math.abs((date?.getTime() ?? Number.NaN) - Date.now());
  observe(`${label}.skew`, { minutes: Math.round(skewMs / 60_000) });
  expect(skewMs, `${label} is within 10 minutes of now`).toBeLessThan(RECENT_MS);
}
