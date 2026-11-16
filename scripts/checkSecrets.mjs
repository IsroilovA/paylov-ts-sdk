#!/usr/bin/env node
/**
 * Scans committed sources, tests, examples, scripts and maintained docs for credential, Basic
 * authorization, one-time code, card, personal-data and JWT literals, and `.wire.json` fixtures
 * for non-synthetic UUIDs. `docs/vendor/` mirrors Paylov's public pages and is not scanned.
 */

import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { report } from './report.mjs';
import { secretProblems, wireFixtureProblems } from './secretLiterals.mjs';

const scanned = ['{src,tests,examples,scripts}/**/*.{ts,mjs,json,md}', 'docs/**/*.md', '*.md'];
const unscanned = ['docs/vendor/**'];

/**
 * Problems in the scanned files, each prefixed with its repository-relative path.
 * @param {ReadonlyMap<string, string>} files repository-relative path to content
 * @returns {string[]}
 */
export function repositorySecretProblems(files) {
  return [...files].flatMap(([file, content]) => {
    const problems = secretProblems(file, content);
    if (file.endsWith('.wire.json')) problems.push(...wireFixtureProblems(content));
    return problems.map((problem) => `${file}: ${problem}`);
  });
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const paths = globSync(scanned, { cwd: root, exclude: unscanned }).toSorted();
  const files = new Map(paths.map((file) => [file, readFileSync(resolve(root, file), 'utf8')]));
  report('check:secrets', repositorySecretProblems(files), 'no high-signal secret literals found');
}
