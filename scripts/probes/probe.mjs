/**
 * Raw HTTP probes against the Paylov DEV sandbox, for request shapes the SDK refuses or reshapes.
 *
 * Run with `node --env-file=<external env file> scripts/probes/<probe>.mjs`, using the variables
 * of `.env.example`. A probe is one `withProbe(label, fn)` call; the label (a letter, then letters,
 * digits or hyphens) names its captures:
 *
 * ```js
 * await withProbe('bankList', async (probe) => {
 *   const { status, body } = await probe.rest('GET', '/merchant/bankList/');
 * });
 * ```
 *
 * - `probe.rest(method, path, { query, body, auth, keepHeaders })` resolves `path` against
 *   `PAYLOV_BASE_URL`. `auth` is `'bearer'` (default), `'basic'` (consumer key and secret),
 *   `'none'`, or `{ bearer: token }` to send a chosen token, such as a superseded or malformed one.
 *   Bearer calls share one lazy password grant per run; only a token-endpoint 429 permits one retry
 *   after `Retry-After` (otherwise 60 seconds), and a failed grant is never retried.
 * - `probe.supersedeToken()` refreshes the shared grant and resolves to the superseded access
 *   token; later bearer calls use the new one.
 * - `probe.graphql({ query, variables, operationName, keepHeaders })` posts to the DEV checkout
 *   GraphQL endpoint without credentials.
 * - Both accept only DEV URLs, refuse redirects, and resolve to `{ status, headers, body }`; `body`
 *   is parsed JSON or the raw text.
 * - `probe.redact(value, placeholder)` registers a secret before the call that could echo it.
 *   Credentials, `PAYLOV_LIVE_TEST_CARDS` values and known personal-data fields are redacted
 *   automatically.
 * - `probe.id(value, kind)` returns a stable placeholder such as `<user 1>` for an identifier.
 * - `probe.track.card(cardId)` and `probe.track.hold(transactionId)` register created resources
 *   immediately. Closing releases holds, then deletes cards, even after a thrown probe, and rejects
 *   when any cleanup fails or answers without Paylov's acknowledgement (`status: "cancelled"` for
 *   the released hold, `result: true` for a deleted card).
 *
 * Every response, including the grant and cleanup, is written to the git-ignored `captures/`, or to
 * `PAYLOV_CAPTURE_DIR` outside this checkout, as `NNN_<label>.json`, numbered across labels. A
 * capture keeps the redacted request with query values replaced, the status, `content-type`,
 * `retry-after` and `keepHeaders`, and the redacted body. `keepHeaders` refuses cookie,
 * authorization, token, session and key headers. A re-read scan deletes the capture and throws when a known secret,
 * Luhn-valid PAN or JWT remains; that is a backstop, not permission to send unregistered secrets.
 * Tokens stay in memory.
 */

import { setTimeout } from 'node:timers/promises';

import { assertDevUrl, readSandboxConfig, SANDBOX_GRAPHQL_URL } from '../sandboxConfig.mjs';
import { assertCaptureLabel, sdkCommit, writeCapture } from './captures.mjs';
import { captureDirectory } from './paths.mjs';
import { loadRedactor } from './redaction.mjs';

/** @typedef {'bearer' | 'basic' | 'none' | { bearer: string }} Auth */
/** @typedef {{ accessToken: string, refreshToken: unknown }} Tokens */
/** @typedef {{ status: number, headers: Headers, body: unknown }} ProbeResponse */
/** @typedef {{ query?: Record<string, string | number | boolean>, body?: unknown, auth?: Auth, keepHeaders?: readonly string[] }} RestOptions */
/** @typedef {{ query: string, variables?: unknown, operationName?: string, keepHeaders?: readonly string[] }} GraphqlOptions */
/** @typedef {import('./redaction.mjs').Redactor} Redactor */

const graphqlOrigin = new URL(SANDBOX_GRAPHQL_URL).origin;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string | null} retryAfter */
function retryDelayMs(retryAfter) {
  if (retryAfter !== null && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const date =
    retryAfter !== null && /^[A-Z][a-z]{2}, /.test(retryAfter) ? Date.parse(retryAfter) : NaN;
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 60_000;
}

/** Discards I/O error details, which may carry response content.
 * @param {Response} response @returns {Promise<unknown>}
 */
async function readBody(response) {
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error(`probe response body failed (HTTP ${response.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Replaces query values and path-segment ids or tokens with placeholders.
 * @param {URL} url @param {Redactor} redactor
 */
function redactedUrl(url, redactor) {
  const safe = new URL(url);
  for (const name of new Set(safe.searchParams.keys()))
    safe.searchParams.set(name, '<query value>');
  safe.hash = '';
  safe.pathname = safe.pathname.replace(
    /(\/(?:getCard|bindSession|cardBind)\/)([^/]+)/g,
    (_match, prefix, value) => {
      redactor.learn(decodeURIComponent(value), prefix === '/getCard/' ? 'cardId' : 'token');
      return `${prefix}${redactor.replace(value)}`;
    },
  );
  return redactor.replace(safe.href);
}

/** Headers that carry credentials or sessions, which no capture may keep. */
const credentialHeader = /cookie|auth|token|secret|session|password|key/i;

/** @param {readonly string[]} names */
function assertKeepableHeaders(names) {
  const refused = names.filter((name) => credentialHeader.test(name));
  if (refused.length > 0)
    throw new Error(`keepHeaders refused credential-bearing headers: ${refused.join(', ')}`);
}

/** @param {Headers} headers @param {readonly string[]} extra */
function capturedHeaders(headers, extra) {
  return Object.fromEntries(
    ['content-type', 'retry-after', ...extra].flatMap((name) => {
      const value = headers.get(name);
      return value === null ? [] : [[name.toLowerCase(), value]];
    }),
  );
}

/** @param {{ label: string }} options */
export async function openProbe({ label }) {
  assertCaptureLabel(label);
  const loaded = readSandboxConfig();
  if (typeof loaded === 'string') throw new Error(loaded);
  const config = loaded;
  const directory = await captureDirectory();
  const redactor = loadRedactor();
  const commit = sdkCommit();
  const basic = `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')}`;
  /** @type {Promise<Tokens> | undefined} */
  let grant;
  let closed = false;
  /** @type {Promise<void> | undefined} */
  let closing;
  /** @type {Set<string>} */
  const cards = new Set();
  /** @type {Set<string>} */
  const holds = new Set();

  function assertOpen() {
    if (closed) throw new Error('probe is closed');
  }

  /** @param {Auth} auth @returns {Promise<string | undefined>} */
  async function authorizationFor(auth) {
    if (auth === 'none') return undefined;
    if (auth === 'basic') return basic;
    return `Bearer ${auth === 'bearer' ? await token() : auth.bearer}`;
  }

  /** @param {string} method @param {URL} url @param {RestOptions} options @returns {Promise<ProbeResponse>} */
  async function send(method, url, options) {
    assertKeepableHeaders(options.keepHeaders ?? []);
    for (const [name, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(name, String(value));
    assertDevUrl(url, url.origin === graphqlOrigin ? 'graphql' : 'rest');
    const auth = options.auth ?? 'bearer';
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const authorization = await authorizationFor(auth);
    if (authorization !== undefined) headers.set('Authorization', authorization);
    const init = {
      method,
      headers,
      redirect: /** @type {const} */ ('error'),
      signal: AbortSignal.timeout(30_000),
    };
    let response;
    try {
      response = await fetch(
        url.href,
        options.body === undefined ? init : { ...init, body: JSON.stringify(options.body) },
      );
    } catch {
      throw new Error('probe transport failed; request outcome may be unknown');
    }
    const body = await readBody(response);
    redactor.learn(Object.fromEntries(url.searchParams));
    redactor.learn(options.body);
    redactor.learn(body);
    const capture = {
      ts: new Date().toISOString(),
      sdk_commit: commit,
      environment: 'DEV',
      request: {
        method,
        url: redactedUrl(url, redactor),
        auth: typeof auth === 'object' ? 'chosen bearer' : auth,
        body: options.body ?? null,
      },
      response: {
        status: response.status,
        headers: capturedHeaders(response.headers, options.keepHeaders ?? []),
        body,
      },
    };
    await writeCapture(directory, label, capture, redactor);
    return { status: response.status, headers: response.headers, body };
  }

  /** @param {Record<string, string>} body @param {string} kind @returns {Promise<Tokens>} */
  async function tokenGrant(body, kind) {
    const options = { auth: /** @type {const} */ ('basic'), body };
    const url = new URL('/merchant/oauth2/token/', config.baseUrl);
    let response = await send('POST', url, options);
    if (response.status === 429) {
      await setTimeout(retryDelayMs(response.headers.get('retry-after')));
      response = await send('POST', url, options);
    }
    const tokens = isRecord(response.body) ? response.body : {};
    const { access_token: accessToken, refresh_token: refreshToken } = tokens;
    if (response.status !== 200 || typeof accessToken !== 'string' || accessToken === '') {
      throw new Error(
        `${kind} grant failed (HTTP ${response.status}); no further grant is allowed`,
      );
    }
    return { accessToken, refreshToken };
  }

  async function token() {
    grant ??= tokenGrant(
      { grant_type: 'password', username: config.username, password: config.password },
      'password',
    );
    return (await grant).accessToken;
  }

  async function supersedeToken() {
    assertOpen();
    await token();
    const current = /** @type {Promise<Tokens>} */ (grant);
    const { accessToken, refreshToken } = await current;
    if (typeof refreshToken !== 'string') throw new Error('the grant returned no refresh token');
    grant = tokenGrant({ grant_type: 'refresh_token', refresh_token: refreshToken }, 'refresh');
    await grant;
    return accessToken;
  }

  /** @param {string} method @param {string} path @param {RestOptions} options */
  async function rest(method, path, options = {}) {
    assertOpen();
    let url;
    try {
      url = new URL(path, config.baseUrl);
    } catch {
      throw new Error('probe path is not a valid URL');
    }
    assertDevUrl(url);
    return send(method, url, options);
  }

  /** @param {GraphqlOptions} input */
  async function graphql({ keepHeaders, ...body }) {
    assertOpen();
    return send('POST', new URL(SANDBOX_GRAPHQL_URL), {
      body,
      auth: 'none',
      ...(keepHeaders === undefined ? {} : { keepHeaders }),
    });
  }

  /**
   * Accepts only the gateway's recorded acknowledgement, never any other 2xx body.
   * @param {string} kind @param {string} method @param {string} path @param {RestOptions} options
   * @param {(result: unknown) => boolean} acknowledged
   * @returns {Promise<string | undefined>} a value-free failure message
   */
  async function cleanResource(kind, method, path, options, acknowledged) {
    try {
      const response = await send(method, new URL(path, config.baseUrl), options);
      if (response.status < 200 || response.status >= 300) return `${kind} HTTP ${response.status}`;
      const { body } = response;
      if (!isRecord(body) || body['error'] !== null || !acknowledged(body['result']))
        return `${kind} unacknowledged`;
      return undefined;
    } catch {
      return `${kind} cleanup failed`;
    }
  }

  async function cleanup() {
    const failures = [];
    for (const transactionId of holds)
      failures.push(
        await cleanResource(
          'hold',
          'POST',
          '/merchant/payment/hold/dismiss/',
          { body: { transactionId } },
          (result) =>
            isRecord(result) &&
            result['transactionId'] === transactionId &&
            result['status'] === 'cancelled',
        ),
      );
    for (const cardId of cards)
      failures.push(
        await cleanResource(
          'card',
          'DELETE',
          '/merchant/userCard/deleteUserCard/',
          { query: { userCardId: cardId } },
          (result) => result === true,
        ),
      );
    const messages = failures.filter((failure) => failure !== undefined);
    if (messages.length > 0) throw new Error(`probe cleanup: ${messages.join(', ')}`);
  }

  function close() {
    closed = true;
    closing ??= cleanup();
    return closing;
  }

  return {
    rest,
    graphql,
    supersedeToken,
    /** @param {string | number} value @param {string} placeholder */
    redact(value, placeholder = '<registered secret>') {
      redactor.register(value, placeholder);
    },
    /** @param {string | number} value @param {string} kind */
    id(value, kind) {
      return redactor.id(value, kind);
    },
    track: {
      /** @param {string} cardId */
      card(cardId) {
        assertOpen();
        cards.add(cardId);
        redactor.id(cardId, 'card');
      },
      /** @param {string} holdId */
      hold(holdId) {
        assertOpen();
        holds.add(holdId);
        redactor.id(holdId, 'tx');
      },
    },
    close,
  };
}

/** @template T @param {string} label @param {(probe: Awaited<ReturnType<typeof openProbe>>) => Promise<T>} fn */
export async function withProbe(label, fn) {
  const probe = await openProbe({ label });
  try {
    return await fn(probe);
  } finally {
    await probe.close();
  }
}
