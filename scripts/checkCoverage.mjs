#!/usr/bin/env node
/**
 * Rejects an empty coverage report and one missing a file vitest.config.ts holds at 100%, which
 * would pass that floor vacuously; Vitest enforces the floors themselves.
 */

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { report } from './report.mjs';

/** @typedef {{ total: number }} Metric */
/** @typedef {{ lines: Metric, statements: Metric, functions: Metric, branches: Metric }} Summary */

const root = resolve(import.meta.dirname, '..');
/** @type {{ default: import('vitest/config').ViteUserConfig }} */
const { default: config } = await import(pathToFileURL(resolve(root, 'vitest.config.ts')).href);
const thresholds = Object.entries(config.test?.coverage?.thresholds ?? {});
const fullCoverageFiles = thresholds.flatMap(([file, threshold]) =>
  typeof threshold === 'object' && '100' in threshold && threshold[100] === true ? [file] : [],
);
const metrics = /** @type {const} */ (['statements', 'lines', 'branches', 'functions']);
/** @type {Record<string, Summary>} */
const summaries = JSON.parse(readFileSync(resolve(root, 'coverage/coverage-summary.json'), 'utf8'));
/** @type {string[]} */
const problems = [];
/** @type {Set<string>} */
const executable = new Set();

for (const [absolutePath, summary] of Object.entries(summaries)) {
  if (absolutePath === 'total') continue;
  if (!metrics.some((metric) => summary[metric].total > 0)) continue;
  executable.add(relative(root, absolutePath));
}

if (executable.size === 0) problems.push('coverage report contains no executable source files');
if (fullCoverageFiles.length === 0) problems.push('vitest.config.ts holds no file at 100%');
for (const file of fullCoverageFiles) {
  if (!executable.has(file)) problems.push(`coverage report is missing executable ${file}`);
}

report(
  'check:coverage',
  problems,
  `${executable.size} executable files, including ${fullCoverageFiles.join(' and ')}`,
);
