/** Static module edges: imports, side-effect imports, re-exports and `import()`. */

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';

/** @typedef {{ specifier: string, runtime: boolean }} ImportEdge */

/** TypeScript files under `directory`, as absolute paths. @param {string} directory */
export function sourceFiles(directory) {
  return globSync('**/*.ts', { cwd: directory }).map((file) => join(directory, file));
}

/**
 * A statement is type-only when it names bindings and every one is a type. `import Default,
 * { type T }` still loads the module for its default binding.
 * @param {readonly { isType: boolean }[]} entries
 */
function onlyTypes(entries) {
  return entries.length > 0 && entries.every((entry) => entry.isType);
}

/** @param {string} path @returns {ImportEdge[]} */
export function importsOf(path) {
  return importsOfSource(path, readFileSync(path, 'utf8'));
}

/** @param {string} path names the language @param {string} source @returns {ImportEdge[]} */
export function importsOfSource(path, source) {
  const { module } = parseSync(path, source);
  /** @type {ImportEdge[]} */
  const edges = [];

  for (const { moduleRequest, entries } of module.staticImports) {
    edges.push({ specifier: moduleRequest.value, runtime: !onlyTypes(entries) });
  }
  for (const { entries } of module.staticExports) {
    const specifier = entries[0]?.moduleRequest?.value;
    if (specifier !== undefined) edges.push({ specifier, runtime: !onlyTypes(entries) });
  }
  for (const { moduleRequest } of module.dynamicImports) {
    const text = source.slice(moduleRequest.start, moduleRequest.end);
    const specifier = /^(['"`])([^'"`$]*)\1$/.exec(text)?.[2] ?? '<dynamic>';
    edges.push({ specifier, runtime: true });
  }
  return edges;
}
