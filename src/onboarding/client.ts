/** The operator onboarding step that issues merchant API credentials. */

import { orOnMiss, readCall, send } from '../core/call.js';
import { readSurfaceTransport } from '../core/config.js';
import { createHttpClient } from '../core/http.js';
import { readConfig } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { decodeOnboardingCompleted, decodeTokenUsable } from './decoders.js';
import type {
  CheckOnboardingTokenParams,
  CompleteOnboardingParams,
  OnboardingCompleted,
  PaylovOnboardingConfig,
} from './types.js';

export const ENDPOINTS = {
  checkToken: {
    method: 'GET',
    route: '/merchant/onboarding/',
    shape: 'flat',
    miss: 'invalid_or_expired',
  },
  complete: { method: 'POST', route: '/merchant/onboarding/', shape: 'flat' },
} as const;

/**
 * Completes Paylov merchant onboarding with the single-use token Paylov issues. It needs no
 * merchant credentials and is an operator step, run once, not part of a running integration.
 * The token travels in the query string and is never logged; the password and the issued
 * consumer secret never reach logger events or errors.
 *
 * @example
 * const onboarding = new PaylovOnboarding({ baseUrl: 'https://dev.gw.paylov.uz' });
 * if (!(await onboarding.checkToken({ token: onboardingToken }))) {
 *   throw new Error('onboarding token is consumed or expired; ask Paylov for a new one');
 * }
 *
 * @throws {@link PaylovInputError} `sdk_config_error` for malformed configuration.
 */
export class PaylovOnboarding {
  readonly #http: HttpClient;

  constructor(config: PaylovOnboardingConfig) {
    this.#http = createHttpClient(
      readSurfaceTransport(readConfig(config, 'PaylovOnboarding config')),
    );
  }

  /**
   * Checks whether an onboarding token can still be used (`GET /merchant/onboarding/?token=`).
   * Resolves `false` when Paylov reports the token unknown, consumed or expired
   * (`invalid_or_expired`).
   *
   * @throws {@link PaylovApiError} any other gateway error, e.g. `validation_error`.
   *
   * @example
   * const usable = await onboarding.checkToken({ token: onboardingToken });
   * if (!usable) throw new Error('ask Paylov for a new onboarding token');
   */
  async checkToken(
    params: CheckOnboardingTokenParams,
    options?: PaylovCallOptions,
  ): Promise<boolean> {
    const method = 'onboarding.checkToken';
    const { input, signal } = readCall(params, options, method);
    const query = { token: input.string('token') };
    const request = send(this.#http, ENDPOINTS.checkToken, { query, signal }, decodeTokenUsable);
    return orOnMiss(request, ENDPOINTS.checkToken, false);
  }

  /**
   * Sets the merchant API username and password and returns the issued credentials
   * (`POST /merchant/onboarding/?token=`). The token is single-use and `consumerSecret` is shown
   * only once: persist the whole result before doing anything else. The account stays inactive
   * until Paylov activates it; until then a `PaylovClient` with these credentials fails with
   * `invalid_grant`.
   *
   * Recovery: never retried. When `isPaylovOutcomeUnknown(error)`, the credentials may have been
   * issued and lost: call `checkToken`; `true` means `complete` can run again, `false` that the
   * token was used, so ask Paylov to reissue the credentials.
   *
   * @throws {@link PaylovApiError} `validation_error` (see `fields`), or `invalid_or_expired`
   *   for an unknown, used or expired token.
   *
   * @example
   * const credentials = await onboarding.complete({
   *   token: onboardingToken,
   *   username: merchantUsername,
   *   password: merchantPassword,
   * });
   * await secretManager.store('paylov', credentials);
   */
  async complete(
    params: CompleteOnboardingParams,
    options?: PaylovCallOptions,
  ): Promise<OnboardingCompleted> {
    const method = 'onboarding.complete';
    const { input, signal } = readCall(params, options, method);
    const query = { token: input.string('token') };
    const body = {
      username: input.string('username'),
      password: input.string('password'),
    };
    return send(this.#http, ENDPOINTS.complete, { query, body, signal }, decodeOnboardingCompleted);
  }
}
