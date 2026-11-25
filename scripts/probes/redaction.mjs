import { CREDENTIAL_NAMES, env, parseTestCards } from '../sandboxConfig.mjs';
import {
  cardNumberInText,
  dottedToken,
  fieldKind,
  hasSensitiveShape,
  isCardRecord,
  isLuhnValid,
} from '../sensitiveData.mjs';
import { ProbeError } from './probeError.mjs';

/** @typedef {import('../sensitiveData.mjs').SensitiveKind} SensitiveKind */
/** @typedef {{ value: string, kind: string, placeholder: string, context: boolean }} Secret */
/** @typedef {{ kind: string, count: number }} Hit */
/** @type {ReadonlyMap<string, string>} */
const placeholders = new Map([
  ['PAN', '<test card PAN>'],
  ['expiry', '<test card expiry>'],
  ['OTP', '<test card OTP>'],
  ['PINFL', '<test PINFL>'],
  ['phone', '<test phone>'],
  ['credential', '<credential>'],
  ['login', '<credential>'],
  ['token', '<token>'],
  ['name', '<personal name>'],
  ['passport', '<test passport>'],
  ['account', '<test bank account>'],
  ['date', '<test personal date>'],
  ['nationality', '<test nationality>'],
]);
/**
 * A value found only by its field name is not a listed secret: a probe may have sent a deliberately
 * wrong OTP or password, so its placeholder must not claim it was the test-card value.
 * @type {ReadonlyMap<string, string>}
 */
const unlistedPlaceholders = new Map([
  ['PAN', '<PAN not on the secret list>'],
  ['expiry', '<expiry not on the secret list>'],
  ['OTP', '<OTP not on the secret list>'],
  ['PINFL', '<PINFL not on the secret list>'],
  ['phone', '<phone not on the secret list>'],
  ['credential', '<credential-like value not on the secret list>'],
  ['login', '<credential-like value not on the secret list>'],
  ['token', '<token>'],
  ['name', '<personal name>'],
  ['passport', '<passport>'],
  ['account', '<bank account>'],
  ['date', '<personal date>'],
  ['nationality', '<nationality>'],
]);

/** @param {string} value */
function isPlaceholder(value) {
  return /^<[^>]*>$/.test(value);
}

/** Short or common values are replaced only in their own fields or beside a full PAN, never in
 * amounts, timestamps or other text.
 * @param {string} kind
 */
function isContextual(kind) {
  return ['expiry', 'OTP', 'date', 'nationality'].includes(kind);
}

/** @param {string} key */
function identifierKind(key) {
  const name = key.replace(/[_-]/g, '').toLowerCase();
  // `createUserCard/` returns the new card id as `cid`.
  if (name === 'cardid' || name === 'cid') return 'card';
  if (/^(?:transactionid|holdid|txid|externalid)$/.test(name)) return 'tx';
  if (/^(?:userid|customerid|accountid)$/.test(name)) return 'user';
  if (/^(?:merchantid|serviceid|submerchantid)$/.test(name)) return 'merchant';
  if (/^(?:rrn|terminalid|fiscalsign)$/.test(name)) return name;
  return undefined;
}

/** One traversal owns field context for discovery and replacement: a card record's `number` is
 * visited as `pan`, and `message` marks a list element under the `data` of a `validation_error`
 * envelope, where the gateway names fields it rejected, such as `token: ["This field is required."]`.
 * @param {unknown} value @param {string} key
 * @param {(value: unknown, key: string, message: boolean) => unknown} visit
 * @param {boolean} validationData @param {boolean} listed @returns {unknown}
 */
function mapFields(value, key, visit, validationData = false, listed = false) {
  if (Array.isArray(value))
    return value.map((child) => mapFields(child, key, visit, validationData, true));
  if (value !== null && typeof value === 'object') {
    const card = isCardRecord(Object.keys(value), key);
    const validation = 'code' in value && value.code === 'validation_error';
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [
        name,
        mapFields(
          child,
          card && name === 'number' ? 'pan' : name,
          visit,
          validationData || (validation && name === 'data'),
        ),
      ]),
    );
  }
  return visit(value, key, validationData && listed);
}

/**
 * @param {Secret} secret @param {string} key @param {boolean} containedPan
 */
function applies(secret, key, containedPan) {
  if (!secret.context) return true;
  const kind = fieldKind(key);
  return containedPan || kind === secret.kind || kind === 'PAN';
}

/** Credential-like field names that a validation message may carry as the field it rejected.
 * @type {ReadonlySet<string>}
 */
const messageKinds = new Set(['token', 'credential', 'login']);

/** The sensitive kind of a real-shaped value under a sensitive field name.
 * @param {string} value @param {string} key @param {boolean} message
 * @returns {SensitiveKind | undefined}
 */
function shapeKind(value, key, message) {
  if (value === '' || isPlaceholder(value)) return undefined;
  const kind = fieldKind(key);
  if (kind === undefined || (message && messageKinds.has(kind))) return undefined;
  return hasSensitiveShape(kind, value) ? kind : undefined;
}

/** Placeholders, masks and canaries already in a capture are not values to report.
 * @param {string} value
 */
function isRecordedRedaction(value) {
  return /[<*>]|redacted|^EXAMPLE-/i.test(value);
}

export class Redactor {
  /** @type {Secret[]} */
  secrets = [];
  /** @type {Map<string, Map<string, string>>} */
  identifiers = new Map();

  /** @param {string | number} value @param {string} placeholder @param {string} kind @param {boolean} context */
  register(value, placeholder, kind = 'registered secret', context = false) {
    const literal = String(value);
    if (literal === '') return;
    if (literal === placeholder)
      throw new Error('a redaction placeholder must differ from the secret');
    if (this.secrets.some((secret) => secret.value === literal && secret.kind === kind)) return;
    this.secrets.push({ value: literal, kind, placeholder, context });
    const encoded = encodeURIComponent(literal);
    if (encoded !== literal) this.secrets.push({ value: encoded, kind, placeholder, context });
  }

  /** @param {string | number} value @param {string} kind */
  id(value, kind) {
    if (!/^[a-z][a-z ]*$/i.test(kind)) throw new Error('identifier kind must be a plain label');
    const literal = String(value);
    let values = this.identifiers.get(kind);
    if (values === undefined) {
      values = new Map();
      this.identifiers.set(kind, values);
    }
    let placeholder = values.get(literal);
    if (placeholder === undefined) {
      const index = values.size + 1;
      const suffix = kind === 'card' ? String.fromCharCode(64 + index) : String(index);
      placeholder = `<${kind} ${suffix}>`;
      values.set(literal, placeholder);
      this.register(literal, placeholder, 'identifier', /^\d{1,7}$/.test(literal));
    }
    return placeholder;
  }

  /** Registers a real-shaped field value missing from the secret list, so every copy of it is
   * replaced, including copies in free text or preceding their source field.
   * @param {string} literal @param {SensitiveKind | undefined} kind
   */
  #registerUnlisted(literal, kind) {
    if (kind === undefined || this.secrets.some((secret) => secret.value === literal)) return;
    this.register(
      literal,
      unlistedPlaceholders.get(kind) ?? '<redacted>',
      kind,
      isContextual(kind),
    );
  }

  /** Discovers identifiers and sensitive fields before any string is replaced.
   * @param {unknown} value @param {string} key
   */
  learn(value, key = '') {
    mapFields(value, key, (field, name, message) => {
      if (typeof field !== 'string' && typeof field !== 'number') return field;
      const literal = String(field);
      if (isPlaceholder(literal)) return field;
      const idKind = identifierKind(name);
      if (idKind !== undefined) this.id(field, idKind);
      this.#registerUnlisted(literal, shapeKind(literal, name, message));
      return field;
    });
  }

  /** @param {string} value @param {string} key @param {(kind: string) => void} hit */
  replace(value, key = '', hit = () => undefined) {
    const containedPan =
      this.secrets.some((secret) => secret.kind === 'PAN' && value.includes(secret.value)) ||
      [...value.matchAll(cardNumberInText)].some(([literal]) => isLuhnValid(literal));
    let result = value;
    const ordered = this.secrets.toSorted(
      (a, b) =>
        b.value.length - a.value.length ||
        Number(b.kind === 'identifier') - Number(a.kind === 'identifier'),
    );
    for (const secret of ordered) {
      if (!applies(secret, key, containedPan)) continue;
      result = result.replaceAll(secret.value, () => {
        hit(secret.kind);
        return secret.placeholder;
      });
    }
    result = result.replace(cardNumberInText, (literal) => {
      if (!isLuhnValid(literal)) return literal;
      hit('PAN');
      return '<test card PAN>';
    });
    return result.replace(dottedToken, () => {
      hit('JWT');
      return '<token>';
    });
  }

  /** @param {unknown} value @param {string} key @returns {unknown} */
  clean(value, key = '') {
    return mapFields(value, key, (field, name, message) => {
      if (typeof field !== 'string' && typeof field !== 'number') return field;
      const idKind = identifierKind(name);
      if (idKind !== undefined && !isPlaceholder(String(field))) return this.id(field, idKind);
      const text = this.replace(String(field), name);
      const kind = shapeKind(text, name, message);
      if (kind !== undefined) return unlistedPlaceholders.get(kind) ?? '<redacted>';
      return text === String(field) ? field : text;
    });
  }

  /** Discovers sensitive fields from the parsed capture, then replaces every occurrence of a
   * secret literal in the source, preserving JSON whitespace, numbers and escaping elsewhere.
   * @param {string} source @returns {{ text: string, hits: Hit[] }}
   */
  scan(source) {
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new ProbeError('capture is not valid JSON');
    }
    mapFields(parsed, '', (field, name, message) => {
      if (typeof field !== 'string' && typeof field !== 'number') return field;
      const literal = String(field);
      if (!isRecordedRedaction(literal))
        this.#registerUnlisted(literal, shapeKind(literal, name, message));
      return field;
    });
    /** @type {Map<string, number>} */
    const counts = new Map();
    let key = '';
    const hit = (/** @type {string} */ kind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const text = source.replace(
      /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (token, offset) => {
        if (
          source
            .slice(offset + token.length)
            .trimStart()
            .startsWith(':')
        ) {
          key = JSON.parse(token);
          const replacement = this.replace(key, '', hit);
          return replacement === key ? token : JSON.stringify(replacement);
        }
        const value = String(JSON.parse(token));
        const replacement = this.replace(value, key, hit);
        return value === replacement ? token : JSON.stringify(replacement);
      },
    );
    return { text, hits: [...counts].map(([kind, count]) => ({ kind, count })) };
  }
}

/** Reads only known variable names; `PAYLOV_PROBE_SECRETS` is data, never an env file.
 * @returns {Redactor}
 */
export function loadRedactor() {
  const redactor = new Redactor();
  for (const name of CREDENTIAL_NAMES) {
    const value = env(name);
    if (value !== undefined) redactor.register(value, '<credential>', 'credential');
  }
  const key = env('PAYLOV_CONSUMER_KEY');
  const secret = env('PAYLOV_CONSUMER_SECRET');
  if (key !== undefined && secret !== undefined) {
    redactor.register(
      Buffer.from(`${key}:${secret}`).toString('base64'),
      '<credential>',
      'credential',
    );
  }
  loadCards(redactor, env('PAYLOV_LIVE_TEST_CARDS'));
  loadSecretEntries(redactor, env('PAYLOV_PROBE_SECRETS'));
  return redactor;
}

/** @param {Redactor} redactor @param {string | undefined} input */
function loadCards(redactor, input) {
  if (input === undefined) return;
  const cards = parseTestCards(input);
  if (typeof cards === 'string') throw new ProbeError(cards);
  for (const card of cards) {
    for (const [kind, value] of Object.entries({
      PAN: card.pan,
      expiry: card.expiry,
      OTP: card.otp,
    })) {
      redactor.register(value, placeholders.get(kind) ?? '<redacted>', kind, isContextual(kind));
    }
  }
}

/** `key=value` entries separated by `;`; a key without a personal kind is a credential.
 * @param {Redactor} redactor @param {string | undefined} input
 */
function loadSecretEntries(redactor, input) {
  if (input === undefined) return;
  for (const entry of input.split(';')) {
    if (entry.trim() === '') continue;
    const match = /^\s*([\w.-]+)\s*=\s*(\S(?:.*\S)?)\s*$/.exec(entry);
    if (match === null) throw new ProbeError('PAYLOV_PROBE_SECRETS entries must be key=value');
    const kind = fieldKind(match[1] ?? '') ?? 'credential';
    redactor.register(
      match[2] ?? '',
      placeholders.get(kind) ?? '<credential>',
      kind,
      isContextual(kind),
    );
  }
}
