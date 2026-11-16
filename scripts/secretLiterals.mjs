/** High-signal secret checks. Reports categories and key names only, never the rejected values. */

import { extname } from 'node:path';
import { parseSync, Visitor } from 'oxc-parser';

import {
  containsCardNumber,
  dottedToken,
  fieldKind,
  hasSensitiveShape,
  hasSyntheticDigits,
  isCardRecord,
  isCredentialLiteral,
  jwtLiteral,
} from './sensitiveData.mjs';

/**
 * A key/value pair found in a file. `siblings` are the other keys of the same object and `parent`
 * the key that holds that object; the Markdown prose scan knows neither.
 * @typedef {{ key: string, value: string, siblings: readonly string[], parent: string | undefined }} Field
 */
/** @typedef {import('oxc-parser').PropertyKey | import('oxc-parser').BindingPattern} KeyNode */
/** @typedef {import('./sensitiveData.mjs').SensitiveKind} SensitiveKind */

/**
 * Unmistakable placeholders: an all-caps letter phrase (`EXAMPLE-OTP-NOT-A-REAL-CODE`,
 * `PAN-FROM-SECURE-INPUT`, `SECRET`), an `<ANGLE_NAME>`, or a short elided docs value
 * (`pR3x...kLq9`). Lowercase letters, digits or symbols make a value real-shaped.
 */
const placeholder =
  /^(?:[A-Z]+(?:[-_][A-Z]+)*|<[A-Z]+(?:_[A-Z]+)*>|[A-Za-z0-9]{0,4}(?:\.{3}|…)[A-Za-z0-9]{0,4})$/;

/** `key: 'value'`, `"key" = "value"`, ``Key: `value` `` and `key: 123` in prose and code samples. */
const proseField =
  /(?<![?&\w$])(["'`]?)([A-Za-z_]\w*)\1\s*[:=]\s*(?:(["'`])(.*?)\3|(\d[\d -]*\d))/g;
const queryCredential = /[?&](?:\w*token|password|secret)=([^&#\s"'`)\]]+)/gi;
const codeFence = /^```(json|ts|typescript|js|javascript)\n([\s\S]*?)^```/gm;
/** `Basic <base64>` in any casing; the value is checked by what it decodes to. */
const basicCredential = /\bbasic\s+([A-Za-z0-9+/]{4,}={0,2})(?![\w+/=-])/gi;

/** `?token=<value>` with a real-shaped value; `${...}` and `<...>` mark substituted values. @param {string} text */
function hasQueryCredential(text) {
  return [...text.matchAll(queryCredential)].some(
    ([, value = '']) => !placeholder.test(value) && !/^[$<{]/.test(value),
  );
}

/**
 * A literal `Basic` value that decodes to `login:password`, unless the password is a placeholder.
 * @param {string} text
 */
function hasBasicCredential(text) {
  return [...text.matchAll(basicCredential)].some(([, value = '']) => {
    const decoded = /^[\x21-\x39\x3b-\x7e]+:([\x21-\x7e]+)$/.exec(
      Buffer.from(value, 'base64').toString('latin1'),
    );
    return decoded !== null && !placeholder.test(decoded[1] ?? '');
  });
}

/** @param {string} category @returns {(key: string) => string} */
const placeholderNeeded = (category) => (key) =>
  `${category} literal in "${key}" must be an explicit placeholder`;
/** @param {string} category @returns {(key: string) => string} */
const syntheticNeeded = (category) => (key) => `${category} literal in "${key}" must be synthetic`;

/**
 * What a real-shaped, non-placeholder value of a kind needs instead, as a value-free message.
 * `isReal` replaces the recorded-data shape where a literal is judged differently.
 * @typedef {{
 *   synthetic: boolean,
 *   problem: (key: string) => string,
 *   isReal?: (value: string) => boolean,
 * }} KindRule
 */

/** @type {KindRule} */
const credentialRule = {
  synthetic: false,
  problem: placeholderNeeded('credential-shaped'),
  isReal: isCredentialLiteral,
};

/**
 * Personal ids pass with synthetic digits. A login name, a card expiry, a personal date or a
 * nationality code grants or identifies nothing alone, so only the probe redactor replaces them.
 * @type {ReadonlyMap<SensitiveKind, KindRule>}
 */
const kindRules = new Map(
  /** @type {readonly [SensitiveKind, KindRule][]} */ ([
    ['PAN', { synthetic: false, problem: (key) => `full-PAN-shaped literal in "${key}"` }],
    ['OTP', { synthetic: false, problem: placeholderNeeded('one-time-code') }],
    ['token', credentialRule],
    ['credential', credentialRule],
    [
      'phone',
      {
        synthetic: true,
        problem: (key) => `phone literal in "${key}" must be masked or synthetic`,
      },
    ],
    ['PINFL', { synthetic: true, problem: syntheticNeeded('PINFL') }],
    ['passport', { synthetic: true, problem: syntheticNeeded('passport') }],
    ['account', { synthetic: true, problem: syntheticNeeded('bank account') }],
    ['name', { synthetic: false, problem: placeholderNeeded('personal-data') }],
  ]),
);

/** @param {Field} field @returns {string | undefined} */
function fieldProblem({ key, value: raw, siblings, parent }) {
  const value = raw.trim();
  if (value === '' || placeholder.test(value)) return undefined;
  const kind = fieldKind(key, isCardRecord(siblings, parent));
  const rule = kind === undefined ? undefined : kindRules.get(kind);
  if (rule === undefined || kind === undefined) return undefined;
  if (!(rule.isReal?.(value) ?? hasSensitiveShape(kind, value))) return undefined;
  return rule.synthetic && hasSyntheticDigits(value) ? undefined : rule.problem(key);
}

/** @param {unknown} value @param {string | undefined} parent @param {Field[]} fields */
function jsonFields(value, parent, fields) {
  if (Array.isArray(value)) {
    for (const item of value) jsonFields(item, parent, fields);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const siblings = Object.keys(value);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' || typeof child === 'number') {
      fields.push({ key, value: String(child), siblings, parent });
    }
    jsonFields(child, key, fields);
  }
}

/** @param {KeyNode} node */
function keyName(node) {
  if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return undefined;
}

/**
 * The static text of a string, number or expression-free template literal, seen through `as`,
 * `satisfies` and `!` wrappers.
 * @param {import('oxc-parser').Expression | null} node @returns {string | undefined}
 */
function literalText(node) {
  if (node === null) return undefined;
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression'
  ) {
    return literalText(node.expression);
  }
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'Literal' && /^\d[\d_]*n?$/.test(node.raw ?? '')) {
    return (node.raw ?? '').replace(/[_n]/g, '');
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/**
 * Literal-valued object properties, class fields and variables of a TypeScript or JavaScript
 * file; `parent` is the innermost enclosing property or variable name.
 * @param {import('oxc-parser').Program} program @returns {Field[]}
 */
function codeFields(program) {
  /** @type {Field[]} */
  const fields = [];
  /** @type {(string | undefined)[]} */
  const names = [];
  /** @param {KeyNode} key @param {import('oxc-parser').Expression | null} value */
  function enter(key, value) {
    const name = keyName(key);
    const text = literalText(value);
    if (name !== undefined && text !== undefined) {
      fields.push({ key: name, value: text, siblings: [], parent: names.at(-1) });
    }
    names.push(name ?? names.at(-1));
  }
  const exit = () => void names.pop();
  new Visitor({
    ObjectExpression(node) {
      const siblings = node.properties.flatMap((property) =>
        property.type === 'Property' ? (keyName(property.key) ?? []) : [],
      );
      for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        const name = keyName(property.key);
        const text = literalText(property.value);
        if (name !== undefined && text !== undefined) {
          fields.push({ key: name, value: text, siblings, parent: names.at(-1) });
        }
      }
    },
    Property(node) {
      names.push(keyName(node.key) ?? names.at(-1));
    },
    'Property:exit': exit,
    PropertyDefinition(node) {
      enter(node.key, node.value);
    },
    'PropertyDefinition:exit': exit,
    VariableDeclarator(node) {
      enter(node.id, node.init);
    },
    'VariableDeclarator:exit': exit,
  }).visit(program);
  return fields;
}

/** @param {string} source @returns {Field[]} */
function proseFields(source) {
  return [...source.matchAll(proseField)].map((match) => ({
    key: match[2] ?? '',
    value: match[4] ?? match[5] ?? '',
    siblings: [],
    parent: undefined,
  }));
}

/** @typedef {{ fields: Field[], problem?: string }} Scan */

/** A JSON file, structurally. @param {string} source @returns {Scan} */
function scanJson(source) {
  /** @type {Field[]} */
  const fields = [];
  try {
    jsonFields(JSON.parse(source), undefined, fields);
    return { fields };
  } catch {
    return { fields, problem: 'invalid JSON cannot be scanned structurally' };
  }
}

/**
 * Markdown prose plus its JSON, TypeScript and JavaScript code fences, parsed structurally.
 * @param {string} source @returns {Scan}
 */
function scanMarkdown(source) {
  const fields = proseFields(source);
  for (const [, language, block = ''] of source.matchAll(codeFence)) {
    if (language !== 'json') {
      // Samples are fragments (top-level `return`); keep what parses, as the prose scan covers all.
      fields.push(...codeFields(parseSync('fence.ts', block).program));
      continue;
    }
    try {
      jsonFields(JSON.parse(block), undefined, fields);
    } catch {
      // Elided or annotated samples are not JSON; the prose scan above still covers them.
    }
  }
  return { fields };
}

/** TypeScript or JavaScript through its syntax tree. @param {string} path @param {string} source @returns {Scan} */
function scanCode(path, source) {
  const { program, errors } = parseSync(path, source);
  const fields = codeFields(program);
  return errors.length > 0
    ? { fields, problem: 'source cannot be parsed for scanning' }
    : { fields };
}

/** @param {string} path @param {string} source @param {string} extension @returns {Scan} */
function scanByExtension(path, source, extension) {
  if (extension === '.json') return scanJson(source);
  if (extension === '.md') return scanMarkdown(source);
  return scanCode(path, source);
}

/**
 * Checks of whole strings: URL query credentials, Basic values, key material, card numbers and
 * tokens. `unclaimed` are the texts no field rule already flagged; `recorded` marks JSON data,
 * where any dotted token counts.
 * @param {string} source @param {readonly string[]} texts @param {readonly string[]} unclaimed
 * @param {boolean} recorded @returns {string[]}
 */
function textProblems(source, texts, unclaimed, recorded) {
  /** @type {string[]} */
  const problems = [];
  if (texts.some(hasQueryCredential)) {
    problems.push('credential in a URL query must be an explicit placeholder');
  }
  if ([source, ...texts].some(hasBasicCredential)) {
    problems.push('Basic authorization literal must be an explicit placeholder');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) {
    problems.push('private key material');
  }
  if (unclaimed.some(containsCardNumber)) problems.push('Luhn-valid card number in text');
  if (
    jwtLiteral.test(source) ||
    (recorded && texts.some((text) => text.search(dottedToken) !== -1))
  ) {
    problems.push('JWT-shaped literal');
  }
  return problems;
}

/**
 * Checks one file by its extension: JSON structurally, TypeScript and JavaScript through their
 * syntax tree, Markdown through its prose and its code fences.
 * @param {string} path @param {string} source @returns {string[]}
 */
export function secretProblems(path, source) {
  const extension = extname(path);
  const { fields, problem } = scanByExtension(path, source, extension);
  const flagged = fields.map(fieldProblem);
  const values = fields.map((field) => field.value);
  const prose = extension === '.md';
  const texts = prose ? [source] : values;
  const unclaimed = prose ? texts : values.filter((_, index) => flagged[index] === undefined);
  const problems = [
    problem,
    ...flagged,
    ...textProblems(source, texts, unclaimed, extension === '.json'),
  ];
  return [...new Set(problems.filter((entry) => entry !== undefined))];
}

const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Every decoded key and string value. @param {unknown} value @returns {string[]} */
function jsonStrings(value) {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...jsonStrings(child)]);
}

/**
 * A `.wire.json` replays a live capture, so every identifier in it must be synthetic: each UUID in
 * a decoded key or string starts with `5eed`. Invalid JSON is reported by `secretProblems`.
 * @param {string} source @returns {string[]}
 */
export function wireFixtureProblems(source) {
  let fixture;
  try {
    fixture = JSON.parse(source);
  } catch {
    return [];
  }
  const uuids = jsonStrings(fixture).flatMap((text) => [...text.matchAll(uuid)]);
  return uuids.some(([match]) => !match.toLowerCase().startsWith('5eed'))
    ? ['UUID in a .wire.json must be a synthetic 5eed… id']
    : [];
}
