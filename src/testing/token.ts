/** The fake gateway's token endpoint: success by default, scripted failures on request. */

import { isRecord } from '../core/decoding.js';
import type { PaylovErrorCode } from '../core/errorCodes.js';
import { FAKE_AUTH_BODIES, type PaylovFakeFailure, type PaylovFakeSchedule } from '../core/fake.js';
import { failureAnswer, respond, type Answer } from './answers.js';

/** The OAuth2 grant of a token request: the password grant or a refresh. */
export type PaylovFakeGrant = 'password' | 'refresh_token';

/** A scripted token-endpoint failure. */
export interface PaylovFakeTokenFailure extends PaylovFakeFailure {
  /** The grant it answers; default either. */
  readonly grant?: PaylovFakeGrant;
}

/** The script of the token endpoint. Requests without a matching answer succeed with canary tokens. */
export interface PaylovFakeTokenEndpoint {
  /**
   * Fails a token request with a gateway error. `httpStatus` defaults to the gateway's: 401 for
   * `invalid_grant` and `invalid_client`, 429 for `rate_limit_exceeded` (pass `retryAfterSeconds` for its
   * `Retry-After` header), 400 otherwise. A refresh answered `invalid_grant` falls back to one
   * password grant; a password grant answered `invalid_grant` locks the client.
   *
   * @example
   * fake.token.fail('invalid_grant', { grant: 'password' });
   * fake.token.fail('rate_limit_exceeded', { retryAfterSeconds: 48 });
   */
  fail(
    code: PaylovErrorCode,
    failure?: PaylovFakeTokenFailure,
    schedule?: PaylovFakeSchedule,
  ): void;

  /** The grant of every token request received, in order. Never a credential. */
  readonly requests: readonly PaylovFakeGrant[];
}

interface TokenAnswer {
  readonly grant: PaylovFakeGrant | undefined;
  readonly answer: Answer;
  readonly persist: boolean;
  served: boolean;
}

const DEFAULT_STATUS: Readonly<Record<string, number>> = {
  invalid_grant: 401,
  invalid_client: 401,
  rate_limit_exceeded: 429,
};

function grantOf(body: unknown): PaylovFakeGrant | undefined {
  const grant = isRecord(body) ? body['grant_type'] : undefined;
  return grant === 'password' || grant === 'refresh_token' ? grant : undefined;
}

export class FakeTokenEndpoint implements PaylovFakeTokenEndpoint {
  readonly #answers: TokenAnswer[] = [];
  readonly #requests: PaylovFakeGrant[] = [];

  get requests(): readonly PaylovFakeGrant[] {
    return [...this.#requests];
  }

  fail(
    code: PaylovErrorCode,
    failure: PaylovFakeTokenFailure = {},
    schedule: PaylovFakeSchedule = {},
  ): void {
    const { grant, ...details } = failure;
    const httpStatus = details.httpStatus ?? DEFAULT_STATUS[code] ?? 400;
    this.#answers.push({
      grant,
      answer: failureAnswer(code, { ...details, httpStatus }),
      persist: schedule.persist === true,
      served: false,
    });
  }

  /** The answer to one token request: the first matching one-time answer, then a persistent one. */
  answer(body: unknown): Answer {
    const grant = grantOf(body);
    if (grant !== undefined) this.#requests.push(grant);
    const candidates = this.#answers.filter(
      (scripted) => scripted.grant === undefined || scripted.grant === grant,
    );
    const scripted = candidates.find(({ persist }) => !persist) ?? candidates[0];
    if (scripted === undefined) return respond(200, FAKE_AUTH_BODIES.token);
    if (scripted.persist) scripted.served = true;
    else this.#answers.splice(this.#answers.indexOf(scripted), 1);
    return scripted.answer;
  }

  /** What `assertDone()` reports: scripted answers no token request took. */
  problems(): string[] {
    return this.#answers.flatMap(({ persist, served }) => {
      if (!persist) return ['unserved token answer'];
      return served ? [] : ['unserved persistent token answer'];
    });
  }
}
