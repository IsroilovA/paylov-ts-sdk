#!/usr/bin/env node
/** Keeps the published SDK free of runtime dependencies. */

import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join, relative, resolve } from 'node:path';

import { report } from './report.mjs';
import { importsOf, sourceFiles } from './sourceImports.mjs';

/** @typedef {import('./sourceImports.mjs').ImportEdge} ImportEdge */

const dependencyFields = [
  'dependencies',
  'optionalDependencies',
  'bundledDependencies',
  'bundleDependencies',
];

/**
 * Runtime dependency metadata and runtime imports of anything but built-ins and relative modules.
 * @param {{ packageJson: Record<string, unknown>, imports: ReadonlyMap<string, readonly ImportEdge[]> }} input
 *   `imports` maps each repository-relative source path to its edges
 * @returns {string[]}
 */
export function dependencyProblems({ packageJson, imports }) {
  /** @type {string[]} */
  const problems = [];
  const populated = dependencyFields.filter((field) => {
    const value = packageJson[field];
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
  });
  if (populated.length > 0) {
    problems.push(`runtime dependency fields present: ${populated.join(', ')}`);
  }
  for (const [file, edges] of imports) {
    for (const { specifier, runtime } of edges) {
      if (runtime && !specifier.startsWith('.') && !isBuiltin(specifier)) {
        problems.push(`${file} has a forbidden runtime dependency: ${specifier}`);
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const imports = new Map(
    sourceFiles(join(root, 'src')).map((path) => [relative(root, path), importsOf(path)]),
  );
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  report(
    'check:dependencies',
    dependencyProblems({ packageJson, imports }),
    'zero runtime dependencies',
  );
}
