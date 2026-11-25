#!/usr/bin/env node
/**
 * Audits existing probe captures for secrets that survived redaction.
 *
 * Usage: `node --env-file=<env file> scripts/probes/scanCaptures.mjs [<dir>] [--fix]`
 *
 * - Scans every `*.json` file in `<dir>`, else `PAYLOV_CAPTURE_DIR`, else the git-ignored
 *   `captures/`, the same directory the probes write to. A missing directory is an error. It
 *   checks against the credentials and `PAYLOV_LIVE_TEST_CARDS` from the environment, Luhn-valid
 *   PANs, JWTs and personal-data field shapes; a value found in a personal-data field is replaced
 *   wherever it occurs in the file.
 * - `PAYLOV_PROBE_SECRETS` optionally lists more `key=value` entries separated by `;`. Keys such as
 *   `pan`, `expiry`, `otp`, `pinfl` and `phone` set the kind; any other key is a credential. Short
 *   expiry and OTP values match only in card fields or in strings containing a full PAN.
 * - Output names files, kinds, counts and the scanner's own value-free messages, never values. A
 *   file that cannot be read or parsed is reported and the scan goes on. The last line reads
 *   `examined=<files scanned>; flagged=<files with hits>; <kind>=<count>, ...` (or `hits=0`).
 * - Exit status: `0` clean or fixed, `1` hits found, `2` any scan error.
 * - `--fix` replaces only the secret literals and preserves every other byte. Back up the
 *   directory first and scan again afterwards.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { auditedCaptureDirectory } from './paths.mjs';
import { ProbeError } from './probeError.mjs';
import { loadRedactor } from './redaction.mjs';

/** @typedef {import('./redaction.mjs').Hit} Hit */
/** @typedef {import('./redaction.mjs').Redactor} Redactor */

/** @param {readonly Hit[]} hits */
function formatHits(hits) {
  return hits.map(({ kind, count }) => `${kind}=${count}`).join(', ');
}

/** Only the tooling's own messages are printed; others may quote file content. @param {unknown} error */
function safeMessage(error) {
  return error instanceof ProbeError ? error.message : 'scan failed';
}

/**
 * Scans captures in memory and reports each one that holds a secret or cannot be scanned.
 * @param {ReadonlyMap<string, string>} captures file name to content
 * @param {Redactor} redactor
 * @param {boolean} fix
 * @returns {{ lines: string[], fixes: Map<string, string>, status: 0 | 1 | 2 }} the value-free
 *   report lines, the replacement content of each file to fix, and the exit status
 */
export function scanCaptureSources(captures, redactor, fix) {
  /** @type {string[]} */
  const lines = [];
  /** @type {Map<string, string>} */
  const fixes = new Map();
  /** @type {Map<string, number>} */
  const totals = new Map();
  let flagged = 0;
  let failed = false;
  for (const [name, source] of captures) {
    let scan;
    try {
      scan = redactor.scan(source);
    } catch (error) {
      failed = true;
      lines.push(`${name}: ${safeMessage(error)}`);
      continue;
    }
    if (scan.hits.length === 0) continue;
    flagged += 1;
    for (const { kind, count } of scan.hits) totals.set(kind, (totals.get(kind) ?? 0) + count);
    if (fix) fixes.set(name, scan.text);
    lines.push(`${name}: ${formatHits(scan.hits)}${fix ? ' fixed' : ''}`);
  }
  const totalHits = [...totals].map(([kind, count]) => ({ kind, count }));
  lines.push(`examined=${captures.size}; flagged=${flagged}; ${formatHits(totalHits) || 'hits=0'}`);
  if (failed) return { lines, fixes, status: 2 };
  return { lines, fixes, status: flagged > 0 && !fix ? 1 : 0 };
}

/** @param {string[]} args @returns {{ directory: string | undefined, fix: boolean }} */
function parseArgs(args) {
  const directories = args.filter((arg) => arg !== '--fix');
  const fixes = args.length - directories.length;
  if (directories.length > 1 || fixes > 1) {
    throw new ProbeError('usage: scanCaptures.mjs [<dir>] [--fix]');
  }
  return { directory: directories[0], fix: fixes === 1 };
}

/** @param {string[]} args @returns {Promise<number>} the exit status */
async function main(args) {
  const { directory, fix } = parseArgs(args);
  const target = await auditedCaptureDirectory(directory);
  const redactor = loadRedactor();
  const entries = (await readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  let failed = false;
  /** @param {string} line */
  const fail = (line) => {
    failed = true;
    process.stdout.write(`${line}\n`);
  };
  /** @type {Map<string, string>} */
  const captures = new Map();
  for (const { name } of entries) {
    try {
      captures.set(name, await readFile(join(target, name), 'utf8'));
    } catch {
      fail(`${name}: unreadable`);
    }
  }
  const { lines, fixes, status } = scanCaptureSources(captures, redactor, fix);
  for (const [name, text] of fixes) {
    try {
      await writeFile(join(target, name), text, 'utf8');
    } catch {
      fail(`${name}: fix failed`);
    }
  }
  for (const line of lines) process.stdout.write(`${line}\n`);
  return failed ? 2 : status;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`capture scan failed: ${safeMessage(error)}\n`);
    process.exitCode = 2;
  }
}
