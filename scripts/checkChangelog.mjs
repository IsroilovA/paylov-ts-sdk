#!/usr/bin/env node
/**
 * Requires a dated CHANGELOG section and release link for package.json's version, so a version bump
 * without release notes fails on the pull request instead of in the release job. With
 * `--notes <file>`, also writes that section to the file as the GitHub release notes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { report } from './report.mjs';

/**
 * @typedef {object} ReleaseNotes
 * @property {string} notes the section body between its heading and the next one, trimmed
 * @property {string[]} problems
 */

/**
 * Extracts and validates the CHANGELOG section of `version`.
 * @param {{ changelog: string, version: string, repositoryUrl: string }} input
 *   `repositoryUrl` is the repository's web URL, without a trailing slash
 * @returns {ReleaseNotes}
 */
export function releaseNotes({ changelog, version, repositoryUrl }) {
  const lines = changelog.split('\n');
  const headingPrefix = `## [${version}] - `;
  const start = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (start === -1) {
    return { notes: '', problems: [`no '${headingPrefix}YYYY-MM-DD' heading for ${version}`] };
  }
  /** @type {string[]} */
  const problems = [];
  const date = (lines[start] ?? '').slice(headingPrefix.length).trim();
  if (!isCalendarDate(date)) problems.push(`${version} heading date is not YYYY-MM-DD: ${date}`);
  const end = lines.findIndex((line, index) => index > start && isSectionEnd(line));
  const notes = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  if (notes === '') problems.push(`${version} section is empty`);
  const link = `[${version}]: ${repositoryUrl}/releases/tag/v${version}`;
  if (!lines.includes(link)) problems.push(`missing release link: ${link}`);
  return { notes, problems };
}

/** @param {string} line */
function isSectionEnd(line) {
  return line.startsWith('## ') || /^\[[^\]]+\]: /.test(line);
}

/** @param {string} value */
function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * The web URL of package.json's `repository`, as npm normalizes it.
 * @param {unknown} repository
 */
function repositoryWebUrl(repository) {
  const url =
    repository !== null && typeof repository === 'object' && 'url' in repository
      ? repository.url
      : repository;
  if (typeof url !== 'string') throw new Error('package.json has no repository URL');
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { notes: { type: 'string' } } });
  const root = resolve(import.meta.dirname, '..');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const { notes, problems } = releaseNotes({
    changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    version: packageJson.version,
    repositoryUrl: repositoryWebUrl(packageJson.repository),
  });
  if (values.notes !== undefined && problems.length === 0) {
    writeFileSync(values.notes, `${notes}\n`);
  }
  report('check:changelog', problems, `release notes for ${packageJson.version}`);
}
