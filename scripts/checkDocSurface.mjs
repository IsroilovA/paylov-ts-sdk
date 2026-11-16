#!/usr/bin/env node
/** Checks that the usage index covers every public export, namespace, method and topic file. */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseSync } from 'oxc-parser';

import { report } from './report.mjs';
import { sourceFiles } from './sourceImports.mjs';

/** Files whose exported classes are public surfaces with their own INDEX.md row. */
const classFiles = [
  'client.ts',
  'onboarding/client.ts',
  'webhooks/receiver.ts',
  'testing/gateway.ts',
];
/** Package entry points whose runtime exports INDEX.md must mention. */
const entryFiles = ['index.ts', 'testing.ts'];
/** Consumer instruction files that INDEX.md mentions in prose; they are not usage topics. */
const consumerSideFiles = new Set(['CLAUDE.md', 'AGENTS.md']);

/** Runtime export names of the entry point; type-only exports are skipped. @param {string} path @param {string} source */
function valueExportsOf(path, source) {
  const { module } = parseSync(path, source);
  return new Set(
    module.staticExports.flatMap(({ entries }) =>
      entries.flatMap(({ isType, exportName }) =>
        !isType && exportName.name !== null ? [exportName.name] : [],
      ),
    ),
  );
}

/** The `PaylovClient` class declaration, exported or not. @param {import('oxc-parser').Program} program */
function paylovClientClassOf(program) {
  for (const statement of program.body) {
    const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (node?.type === 'ClassDeclaration' && node.id?.name === 'PaylovClient') return node;
  }
  return undefined;
}

/**
 * `[interface, property]` for a `<property>: <X>Resource` class field.
 * @param {import('oxc-parser').ClassElement} member @returns {[string, string] | undefined}
 */
function resourceFieldOf(member) {
  if (member.type !== 'PropertyDefinition' || member.key.type !== 'Identifier') return undefined;
  const type = member.typeAnnotation?.typeAnnotation;
  const name = type?.type === 'TSTypeReference' ? type.typeName : undefined;
  if (name?.type !== 'Identifier' || !name.name.endsWith('Resource')) return undefined;
  return [name.name, member.key.name];
}

/** PaylovClient's `<property>: <X>Resource` fields, keyed by the interface name. @param {string} path @param {string} source */
function namespacesOf(path, source) {
  const { program } = parseSync(path, source);
  const members = paylovClientClassOf(program)?.body.body ?? [];
  /** @type {Map<string, string>} */
  const namespaces = new Map();
  for (const member of members) {
    const field = resourceFieldOf(member);
    if (field !== undefined) namespaces.set(...field);
  }
  return namespaces;
}

/** Usage topic names INDEX.md links bare, `./`-relative or through a `usage/` path. @param {string} index */
function referencedTopicsOf(index) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const [, name] of index.matchAll(/(?:^|[\s(`["'])(?:\.\/)?([\w-]+\.md)\b/g)) {
    if (name !== undefined && !consumerSideFiles.has(name)) names.add(name);
  }
  for (const [, name] of index.matchAll(/(?:docs\/)?usage\/([\w-]+\.md)\b/g)) {
    if (name !== undefined) names.add(name);
  }
  return names;
}

/**
 * @typedef {{ name: string, doc: string }} Member
 * @typedef {{ kind: 'interface' | 'class', name: string, members: Member[] }} Surface
 */

/** @param {string} source @param {readonly { type: string, value: string, end: number }[]} docs @param {number} start */
function docBefore(source, docs, start) {
  const doc = docs.findLast((comment) => comment.end <= start);
  return doc !== undefined && source.slice(doc.end, start).trim() === '' ? doc.value : '';
}

/**
 * Exported `*Resource` interfaces with their method signatures and, in a class file, exported
 * classes with their public methods, each with the JSDoc block directly before it.
 * @param {string} path @param {string} source @param {boolean} withClasses @returns {Surface[]}
 */
function surfacesOf(path, source, withClasses) {
  const { program, comments } = parseSync(path, source);
  const docs = comments.filter(({ type, value }) => type === 'Block' && value.startsWith('*'));
  /** @type {Surface[]} */
  const surfaces = [];
  for (const statement of program.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue;
    const node = statement.declaration;
    if (node?.type === 'TSInterfaceDeclaration' && node.id.name.endsWith('Resource')) {
      const members = node.body.body.flatMap((member) =>
        member.type === 'TSMethodSignature' && member.key.type === 'Identifier'
          ? [{ name: member.key.name, doc: docBefore(source, docs, member.start) }]
          : [],
      );
      surfaces.push({ kind: 'interface', name: node.id.name, members });
    }
    if (withClasses && node?.type === 'ClassDeclaration' && node.id !== null) {
      const members = node.body.body.flatMap((member) =>
        member.type === 'MethodDefinition' &&
        member.kind === 'method' &&
        !member.static &&
        member.key.type === 'Identifier' &&
        (member.accessibility ?? 'public') === 'public'
          ? [{ name: member.key.name, doc: docBefore(source, docs, member.start) }]
          : [],
      );
      surfaces.push({ kind: 'class', name: node.id.name, members });
    }
  }
  return surfaces;
}

/**
 * A surface's methods without `@example`, and those its INDEX.md row omits.
 * @param {string} file @param {Surface} surface @param {readonly string[]} indexLines
 * @param {ReadonlyMap<string, string>} namespaces
 */
function surfaceProblems(file, { kind, name, members }, indexLines, namespaces) {
  /** @type {string[]} */
  const problems = [];
  const label = kind === 'interface' ? `paylov.${namespaces.get(name) ?? '?'}` : name;
  if (kind === 'interface' && !namespaces.has(name)) {
    problems.push(`${file}: ${name} is not a PaylovClient namespace`);
  }
  const row = indexLines.find((line) =>
    kind === 'interface' ? line.includes(`\`${label}\``) : line.includes(name),
  );
  for (const member of members) {
    if (!/(?:^|\s)@example\b/.test(member.doc)) {
      problems.push(`${file}: public method ${label}.${member.name} lacks @example`);
    }
    if (row !== undefined && !row.includes(`\`${member.name}\``)) {
      problems.push(`${file}: method ${member.name} not listed in the ${label} INDEX.md row`);
    }
  }
  return problems;
}

/** Broken topic links and topic files INDEX.md never links. @param {string} index @param {ReadonlySet<string>} topics */
function topicProblems(index, topics) {
  const referenced = referencedTopicsOf(index);
  const broken = [...referenced]
    .filter((name) => name !== 'INDEX.md' && !topics.has(name))
    .map((name) => `INDEX.md references a missing file: docs/usage/${name}`);
  const orphaned = [...topics]
    .filter((name) => !referenced.has(name))
    .map((name) => `topic file never referenced by INDEX.md: docs/usage/${name}`);
  return [...broken.toSorted(), ...orphaned.toSorted()];
}

/**
 * Gaps between the public surface and the usage index.
 * @param {{ sources: ReadonlyMap<string, string>, index: string, topics: readonly string[] }} input
 *   `sources` maps each path relative to src/ to its content; `index` is docs/usage/INDEX.md and
 *   `topics` the other Markdown file names in docs/usage/
 * @returns {{ problems: string[], summary: string }}
 */
export function docSurfaceProblems({ sources, index, topics }) {
  const missing = [...entryFiles, ...classFiles]
    .filter((file) => !sources.has(file))
    .map((file) => `src/${file} is missing`);
  const sourceOf = (/** @type {string} */ file) => sources.get(file) ?? '';
  const valueExports = new Set(
    entryFiles.flatMap((file) => [...valueExportsOf(file, sourceOf(file))]),
  );
  const namespaces = namespacesOf('client.ts', sourceOf('client.ts'));
  const indexLines = index.split('\n');
  const methods = [...sources]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([file, source]) =>
      surfacesOf(file, source, classFiles.includes(file)).flatMap((surface) =>
        surfaceProblems(file, surface, indexLines, namespaces),
      ),
    );
  const exports = [...valueExports]
    .toSorted()
    .filter((name) => !index.includes(name))
    .map((name) => `value export not mentioned in INDEX.md: ${name}`);
  const unlisted = [...namespaces.values()]
    .toSorted()
    .filter((property) => !index.includes(`paylov.${property}`))
    .map((property) => `namespace not mentioned in INDEX.md: paylov.${property}`);
  const topicFiles = new Set(topics.filter((name) => name !== 'INDEX.md'));
  const summary =
    `${valueExports.size} value exports, ${namespaces.size} namespaces, ` +
    `${topicFiles.size} topic files covered by INDEX.md`;
  return {
    problems: [
      ...missing,
      ...methods,
      ...exports,
      ...unlisted,
      ...topicProblems(index, topicFiles),
    ],
    summary,
  };
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const srcDir = join(root, 'src');
  const usageDir = join(root, 'docs', 'usage');
  const sources = new Map(
    sourceFiles(srcDir).map((path) => [relative(srcDir, path), readFileSync(path, 'utf8')]),
  );
  const { problems, summary } = docSurfaceProblems({
    sources,
    index: readFileSync(join(usageDir, 'INDEX.md'), 'utf8'),
    topics: readdirSync(usageDir).filter((name) => name.endsWith('.md')),
  });
  report('check:docs', problems, summary);
}
