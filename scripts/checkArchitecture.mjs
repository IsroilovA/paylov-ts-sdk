#!/usr/bin/env node
/** Layer dependency rules and per-surface file requirements from docs/architecture.md. */

import { existsSync } from 'node:fs';
import { basename, dirname, join, normalize, relative, resolve } from 'node:path';

import { report } from './report.mjs';
import { importsOf, sourceFiles } from './sourceImports.mjs';

/** @typedef {import('./sourceImports.mjs').ImportEdge} ImportEdge */

/** Feature folder → its `docs/paylov` and `docs/usage` pages. */
const features = {
  gateway: ['authentication', 'setup'],
  cards: ['cards', 'cards'],
  payments: ['payments', 'payments'],
  transactions: ['transactions', 'transactions'],
  holds: ['holds', 'holds'],
  splits: ['splits', 'splits'],
  subMerchants: ['sub-merchants', 'splits'],
  fiscalization: ['fiscalization', 'fiscalization'],
};

/** @type {Record<string, string[]>} */
const requiredPaths = {
  ...Object.fromEntries(
    Object.entries(features).map(([name, [paylovPage, usagePage]]) => [
      name,
      [
        `src/${name}/resource.ts`,
        `src/${name}/types.ts`,
        `tests/${name}/${name}.test.ts`,
        `tests/fixtures/${name}`,
        `docs/paylov/${paylovPage}.md`,
        `docs/usage/${usagePage}.md`,
      ],
    ]),
  ),
  onboarding: [
    'src/onboarding/client.ts',
    'tests/onboarding/onboarding.test.ts',
    'tests/fixtures/onboarding',
    'docs/paylov/authentication.md',
    'docs/usage/onboarding.md',
  ],
  webhooks: [
    'src/webhooks/receiver.ts',
    'tests/webhooks/receiver.test.ts',
    'tests/fixtures/webhooks',
    'docs/paylov/callbacks.md',
    'docs/usage/webhooks.md',
  ],
  testing: [
    'src/testing.ts',
    'src/testing/gateway.ts',
    'src/testing/webhooks.ts',
    'tests/testing/gateway.test.ts',
    'tests/testing/replies.test.ts',
    'docs/usage/testing.md',
  ],
};
/** Core modules without I/O, credentials or client state; they import only each other. */
const pureCore = [
  'types',
  'errors',
  'errorCodes',
  'numbers',
  'money',
  'decoding',
  'time',
  'params',
  'fake',
];
/** What a resource feature needs: the pure primitives and the request helpers of `call`. */
const resourceCore = ['call', 'decoding', 'params', 'types', 'errors', 'money', 'time', 'fake'];

/** Folders with a `fake.ts`, which the testing fake gateway assembles or the fakes share. */
const fakeFolders = [...Object.keys(features), 'onboarding', 'webhooks', 'shared'];

/**
 * `core` names the core modules a layer may import, or `all`.
 * @typedef {{ core: readonly string[] | 'all', folders: readonly string[], files?: readonly string[] }} LayerRule
 */

/** Pure core modules and `shared/` import only pure core. @type {LayerRule} */
const pureLayer = { core: pureCore, folders: [] };

/**
 * What each `src/` folder may import besides itself: core modules by name, other folders and
 * root files. Features never import each other; a folder without a rule may import nothing. Only
 * the testing fake reads the client's configuration type and the auth modules.
 * @type {Record<string, LayerRule>}
 */
const layerRules = {
  core: { core: 'all', folders: [] },
  shared: pureLayer,
  webhooks: { core: pureCore, folders: [] },
  ...Object.fromEntries(
    Object.keys(features).map((feature) => [feature, { core: resourceCore, folders: ['shared'] }]),
  ),
  // Credential-free: it builds its own transport, never one with `auth`.
  onboarding: { core: [...resourceCore, 'http', 'config'], folders: [] },
  testing: { core: 'all', folders: fakeFolders, files: ['client.js'] },
};

/** @param {string} path path relative to src/, with any extension */
function isFake(path) {
  return /^[^/]+\/fake\.[jt]s$/.test(path);
}

/** @param {string} path path relative to src/, with any extension */
function isTestingModule(path) {
  return /^testing(?:\.[jt]s$|\/)/.test(path);
}

/**
 * What each root file may import: the entry point anything but the testing surface, the client
 * also not the entry point, the testing entry point only the testing folder and core.
 * @type {Record<string, (target: string) => boolean>}
 */
const rootRules = {
  'index.ts': (target) => !isTestingModule(target),
  'client.ts': (target) => target !== 'index.js' && !isTestingModule(target),
  'testing.ts': (target) => /^(?:testing|core)\//.test(target),
};

/**
 * @param {string} from path relative to src/
 * @param {string} target path relative to src/
 */
function mayImport(from, target) {
  const [layer = '', fromFile] = from.split('/');
  const [targetLayer = '', targetFile] = target.split('/');
  if (fromFile === undefined) return rootRules[layer]?.(target) ?? false;
  const isPure = layer === 'core' && pureCore.includes(basename(fromFile, '.ts'));
  const rule = isPure ? pureLayer : layerRules[layer];
  if (rule === undefined) return false;
  if (targetFile === undefined) return rule.files?.includes(target) ?? false;
  if (targetLayer === 'core')
    return rule.core === 'all' || rule.core.includes(basename(targetFile, '.js'));
  return targetLayer === layer || rule.folders.includes(targetLayer);
}

/**
 * Fakes ship in the package but load only from other fakes and the testing surface.
 * @param {string} from path relative to src/
 * @param {string} target path relative to src/
 */
function mayLoad(from, target) {
  return !isFake(target) || isFake(from) || isTestingModule(from);
}

/**
 * Whether `from` may import `specifier`, at runtime or for types only.
 * @param {string} from path relative to src/, such as `cards/resource.ts`
 * @param {string} specifier relative import specifier
 * @param {boolean} runtime
 */
export function importAllowed(from, specifier, runtime) {
  const target = normalize(join(dirname(from), specifier));
  if (target.startsWith('..')) return false;
  return mayImport(from, target) && (!runtime || mayLoad(from, target));
}

/**
 * Runtime imports in a types module and imports its layer forbids.
 * @param {string} from path relative to src/ @param {readonly ImportEdge[]} edges
 */
function moduleProblems(from, edges) {
  /** @type {string[]} */
  const problems = [];
  const typesModule = basename(from) === 'types.ts';
  for (const { specifier, runtime } of edges) {
    if (typesModule && runtime) problems.push(`src/${from} has a runtime import of ${specifier}`);
    if (specifier.startsWith('.') && !importAllowed(from, specifier, runtime)) {
      problems.push(`src/${from} may not import ${specifier}`);
    }
  }
  return problems;
}

/**
 * Missing surface paths and forbidden imports.
 * @param {{ exists: (path: string) => boolean, imports: ReadonlyMap<string, readonly ImportEdge[]> }} input
 *   `exists` takes a repository-relative path; `imports` maps each path relative to src/ to its edges
 * @returns {{ problems: string[], summary: string }}
 */
export function architectureProblems({ exists, imports }) {
  const missing = Object.entries(requiredPaths).flatMap(([surface, paths]) =>
    paths.filter((path) => !exists(path)).map((path) => `${surface} is missing ${path}`),
  );
  const forbidden = [...imports].flatMap(([from, edges]) => moduleProblems(from, edges));
  const surfaces = Object.keys(requiredPaths).length;
  const rules = Object.keys(layerRules).length;
  return {
    problems: [...missing, ...forbidden],
    summary: `${surfaces} surfaces and ${rules} layer rules verified`,
  };
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const srcDir = join(root, 'src');
  const imports = new Map(
    sourceFiles(srcDir).map((path) => [relative(srcDir, path), importsOf(path)]),
  );
  const { problems, summary } = architectureProblems({
    exists: (path) => existsSync(join(root, path)),
    imports,
  });
  report('check:architecture', problems, summary);
}
