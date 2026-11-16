/**
 * OAuth2 token management and revocation. Every `oauth2` snake_case wire name stays here and in
 * `fake.ts`.
 */

import {
  asNonEmptyString,
  asNonNegativeInteger,
  DecodeFailure,
  decodePayload,
  readFields,
  type Decoder,
} from './decoding.js';
import { abortedError, isPaylovApiError, PaylovApiError, PaylovProtocolError } from './errors.js';
import { endpointName } from './http.js';
import { untilAborted, type ClientLifecycle } from './lifecycle.js';
import type { AuthorizationContext, AuthProvider, HttpClient, HttpResponse } from './types.js';

export const ENDPOINTS = {
  token: { method: 'POST', route: '/merchant/oauth2/token/', shape: 'flat' },
  revoke: { method: 'POST', route: '/merchant/oauth2/revoke/', shape: 'flat' },
} as const;
const REVOKE_ENDPOINT = endpointName(ENDPOINTS.revoke);
const REFRESH_MARGIN_MS = 60_000;
/** Used when a token-endpoint 429 carries no usable `Retry-After` delay. */
const DEFAULT_COOL_DOWN_SECONDS = 60;

interface TokenManagerConfig {
  /** A transport with neither an `AuthProvider` nor the lifecycle: revoke must run after close. */
  readonly http: HttpClient;
  readonly lifecycle: ClientLifecycle;
  readonly consumerKey: string;
  readonly consumerSecret: string;
  readonly username: string;
  readonly password: string;
  /** Test seam for deterministic expiry and cool-down; not in the public client config. */
  readonly now?: () => number;
}

interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds. */
  readonly accessExpiresAt: number;
  readonly refreshExpiresAt: number;
}

function ignore(): void {
  // A failed revocation or an abandoned wait still leaves the client closed.
}

/** Never surfaced: `close()` swallows it. */
function abandonedClose(): Error {
  return abortedError(REVOKE_ENDPOINT, false);
}

function basicAuthHeader(consumerKey: string, consumerSecret: string): string {
  return `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`, 'utf8').toString('base64')}`;
}

/**
 * A lifetime in seconds as the epoch-ms deadline from `issuedAt`. No upper cap: 3600 / 2592000
 * are today's values, and a guessed cap would fail every login if Paylov changed them. Only a
 * zero or unsafe deadline is rejected.
 */
function deadlineFrom(issuedAt: number): Decoder<number> {
  return (value, path) => {
    const lifetime = asNonNegativeInteger(value, path);
    const ms = issuedAt + lifetime * 1000;
    if (lifetime === 0 || !Number.isSafeInteger(ms)) throw new DecodeFailure(path);
    return ms;
  };
}

/** Failures name the field, never its value: the same body holds the tokens. */
function decodeTokenSet(issuedAt: number): Decoder<TokenSet> {
  const asDeadline = deadlineFrom(issuedAt);
  return (value, path) => {
    const field = readFields(value, path);
    field('token_type', asNonEmptyString);
    return {
      accessToken: field('access_token', asNonEmptyString),
      refreshToken: field('refresh_token', asNonEmptyString),
      accessExpiresAt: field('expires_in', asDeadline),
      refreshExpiresAt: field('refresh_expires_in', asDeadline),
    };
  };
}

/**
 * Lazy, process-local, single-flight credential manager. It refreshes 60 s before expiry and
 * adopts each new pair at once, because a refresh rotates the refresh token.
 *
 * - A refresh rejected with `invalid_grant` falls back to one password grant. Nothing else does:
 *   `invalid_client`, a 429 or a connection failure would fail the password grant too, and
 *   failed password attempts lock the merchant account.
 * - An enveloped `invalid_grant` on the password grant is latched: every later `authorize()`
 *   rethrows it without I/O. A bare 401/403 (a proxy) is not a credential verdict and does not.
 * - A token-endpoint HTTP 429 starts a cool-down, decoded envelope or not; until it ends
 *   `authorize()` rethrows it without I/O.
 */
export class TokenManager implements AuthProvider {
  readonly #config: TokenManagerConfig;
  readonly #lifecycle: ClientLifecycle;
  readonly #now: () => number;

  #tokens: TokenSet | undefined;
  #generation = 0;
  #grant: Promise<AuthorizationContext> | undefined;
  #rejectedPassword: PaylovApiError | undefined;
  #coolDown:
    | { readonly until: number; readonly error: PaylovApiError | PaylovProtocolError }
    | undefined;
  #closing: Promise<void> | undefined;

  constructor(config: TokenManagerConfig) {
    this.#config = config;
    this.#lifecycle = config.lifecycle;
    this.#now = config.now ?? Date.now;
  }

  /** Callers race the shared grant against their own signal; this never takes one. */
  async authorize(): Promise<AuthorizationContext> {
    this.#lifecycle.assertOpen();
    if (this.#rejectedPassword !== undefined) throw this.#rejectedPassword;
    const coolDown = this.#coolDown;
    if (coolDown !== undefined && this.#now() < coolDown.until) throw coolDown.error;
    const tokens = this.#tokens;
    if (tokens !== undefined && this.#now() < tokens.accessExpiresAt - REFRESH_MARGIN_MS) {
      return this.#context(tokens);
    }
    return await this.#sharedGrant();
  }

  /** Expires only the access token of that generation, keeping the cheaper refresh grant. */
  invalidate(generation: number): void {
    const tokens = this.#tokens;
    if (tokens !== undefined && generation === this.#generation) {
      this.#tokens = { ...tokens, accessExpiresAt: 0 };
    }
  }

  /**
   * Closes the lifecycle, waits for an in-flight grant to settle, then revokes the newest access
   * token held. Concurrent calls share one revocation; the signal abandons only this wait. Never
   * rejects: the revoke attempt's logger events report a failed revocation.
   */
  async close(signal?: AbortSignal): Promise<void> {
    this.#closing ??= this.#closeAndRevoke();
    await untilAborted(this.#closing, signal, abandonedClose).catch(ignore);
  }

  #sharedGrant(): Promise<AuthorizationContext> {
    if (this.#grant !== undefined) return this.#grant;
    // Registered before the grant starts: its request hook may call close(), which must await it.
    const grant = Promise.withResolvers<AuthorizationContext>();
    this.#grant = grant.promise;
    // Cleared before waiters resume, on failure too, so one failed grant poisons no later caller.
    void this.#refreshOrLogin()
      .finally(() => {
        this.#grant = undefined;
      })
      .then(grant.resolve, grant.reject);
    return grant.promise;
  }

  async #refreshOrLogin(): Promise<AuthorizationContext> {
    const tokens = this.#tokens;
    if (tokens !== undefined && this.#now() < tokens.refreshExpiresAt) {
      try {
        return await this.#requestTokens({
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        });
      } catch (error) {
        if (!isPaylovApiError(error, 'invalid_grant')) throw error;
        this.#tokens = undefined;
      }
    }
    this.#lifecycle.assertOpen();
    try {
      return await this.#requestTokens({
        grant_type: 'password',
        username: this.#config.username,
        password: this.#config.password,
      });
    } catch (error) {
      if (isPaylovApiError(error, 'invalid_grant')) {
        this.#rejectedPassword = error;
        this.#tokens = undefined;
      }
      throw error;
    }
  }

  async #requestTokens(body: Readonly<Record<string, string>>): Promise<AuthorizationContext> {
    const { http, consumerKey, consumerSecret } = this.#config;
    let response: HttpResponse;
    try {
      response = await http.request(ENDPOINTS.token, {
        headers: { authorization: basicAuthHeader(consumerKey, consumerSecret) },
        body,
      });
    } catch (error) {
      const isRateLimited =
        (error instanceof PaylovApiError || error instanceof PaylovProtocolError) &&
        error.httpStatus === 429;
      if (isRateLimited) this.#startCoolDown(error);
      throw error;
    }
    const tokens = decodePayload(response, 'body', decodeTokenSet(this.#now()));
    // Held even after a close, so the revocation targets the newest token; never handed out.
    this.#tokens = tokens;
    this.#generation += 1;
    this.#lifecycle.assertOpen();
    return this.#context(tokens);
  }

  #startCoolDown(error: PaylovApiError | PaylovProtocolError): void {
    const retryAfterSeconds = error instanceof PaylovApiError ? error.retryAfterSeconds : undefined;
    const seconds = retryAfterSeconds ?? DEFAULT_COOL_DOWN_SECONDS;
    this.#coolDown = { until: this.#now() + seconds * 1000, error };
  }

  async #closeAndRevoke(): Promise<void> {
    this.#lifecycle.close();
    await this.#grant?.catch(() => undefined);
    const accessToken = this.#tokens?.accessToken;
    this.#tokens = undefined;
    if (accessToken === undefined) return;
    // Revoke is sent without `Authorization`, the only form that succeeded on every DEV day. A
    // failed revocation leaves the token valid until it expires, and the caller nothing to do;
    // its answer is not read.
    await this.#config.http
      .request(ENDPOINTS.revoke, { body: { token: accessToken } })
      .catch(ignore);
  }

  #context(tokens: TokenSet): AuthorizationContext {
    return { header: `Bearer ${tokens.accessToken}`, generation: this.#generation };
  }
}
