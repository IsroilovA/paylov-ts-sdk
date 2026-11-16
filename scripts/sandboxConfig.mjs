/** Environment loading and the DEV allowlist shared by the live suite and the probes. */

export const SANDBOX_HOST = 'dev.gw.paylov.uz';
export const SANDBOX_GRAPHQL_URL = 'https://dev.app.paylov.uz/graphql/';
export const CREDENTIAL_NAMES = [
  'PAYLOV_CONSUMER_KEY',
  'PAYLOV_CONSUMER_SECRET',
  'PAYLOV_USERNAME',
  'PAYLOV_PASSWORD',
];

/** @param {string} name */
export function env(name) {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** @param {URL} url @param {'rest' | 'graphql'} surface */
export function assertDevUrl(url, surface = 'rest') {
  const expected = surface === 'rest' ? `https://${SANDBOX_HOST}` : SANDBOX_GRAPHQL_URL;
  const allowed = surface === 'rest' ? url.origin === expected : url.href === expected;
  if (!allowed || url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error(`only ${expected} is allowed; any other host is refused`);
  }
}

/** @typedef {{ baseUrl: string, consumerKey: string, consumerSecret: string, username: string, password: string }} SandboxConfig */

/** @returns {SandboxConfig | string} the config, or a skip reason that exposes no value */
export function readSandboxConfig() {
  const rawBase = env('PAYLOV_BASE_URL');
  if (rawBase === undefined) return 'PAYLOV_BASE_URL is not set';
  let base;
  try {
    base = new URL(rawBase);
  } catch {
    return 'PAYLOV_BASE_URL is not a URL';
  }
  try {
    const target = new URL(base);
    target.username = '';
    target.password = '';
    assertDevUrl(target);
  } catch {
    return `PAYLOV_BASE_URL must be https://${SANDBOX_HOST}; any other host is refused`;
  }
  const missing = CREDENTIAL_NAMES.filter((name) => env(name) === undefined);
  if (missing.length > 0) return `missing ${missing.join(', ')}`;
  return {
    baseUrl: base.origin,
    consumerKey: env('PAYLOV_CONSUMER_KEY') ?? '',
    consumerSecret: env('PAYLOV_CONSUMER_SECRET') ?? '',
    username: env('PAYLOV_USERNAME') ?? '',
    password: env('PAYLOV_PASSWORD') ?? '',
  };
}

/** @typedef {{ pan: string, expiry: string, otp: string }} SandboxTestCard */

const TEST_CARD = /^(\d{16}):(\d{4}):(\d{4,6})$/;

/**
 * Parses `PAYLOV_LIVE_TEST_CARDS`: `PAN:YYMM:OTP` entries separated by `;`.
 * @param {string} value @returns {SandboxTestCard[] | string} the cards, or a reason that exposes no value
 */
export function parseTestCards(value) {
  /** @type {SandboxTestCard[]} */
  const cards = [];
  for (const entry of value.split(';')) {
    const match = TEST_CARD.exec(entry.trim());
    if (match === null) return 'PAYLOV_LIVE_TEST_CARDS is malformed';
    cards.push({ pan: match[1] ?? '', expiry: match[2] ?? '', otp: match[3] ?? '' });
  }
  return cards;
}
