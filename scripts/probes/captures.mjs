import { execFileSync } from 'node:child_process';
import { open, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { hasErrorCode, repositoryRoot } from './paths.mjs';

/** @param {string} label */
export function assertCaptureLabel(label) {
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(label))
    throw new Error('probe label must be a safe file label');
}

/** @returns {string} */
export function sdkCommit() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** @param {string[]} files */
function highestNumber(files) {
  return files.reduce(
    (maximum, file) => Math.max(maximum, Number(/^(\d+)_/.exec(file)?.[1] ?? 0)),
    0,
  );
}

/** @param {string} path @returns {Promise<import('node:fs/promises').FileHandle | undefined>} */
async function createExclusive(path) {
  try {
    return await open(path, 'wx', 0o600);
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) return undefined;
    throw error;
  }
}

/**
 * Numbers are global across labels. A `NNN_.claim` reservation coordinates parallel processes;
 * the caller removes it after writing.
 * @param {string} directory @param {string} label
 */
async function claim(directory, label) {
  for (let number = highestNumber(await readdir(directory)) + 1; ; number += 1) {
    const prefix = String(number).padStart(3, '0');
    const reservation = join(directory, `${prefix}_.claim`);
    const lock = await createExclusive(reservation);
    if (lock === undefined) continue;
    await lock.close();
    const path = join(directory, `${prefix}_${label}.json`);
    let handle;
    try {
      handle = (await isTaken(directory, prefix)) ? undefined : await createExclusive(path);
    } catch (error) {
      await unlink(reservation);
      throw error;
    }
    if (handle !== undefined) return { path, handle, reservation };
    await unlink(reservation);
  }
}

/** @param {string} directory @param {string} prefix */
async function isTaken(directory, prefix) {
  const files = await readdir(directory);
  return files.some((file) => file.startsWith(`${prefix}_`) && file.endsWith('.json'));
}

/** Writes only redacted data and deletes any file failing the independent re-read scan.
 * @param {string} directory @param {string} label @param {unknown} capture
 * @param {import('./redaction.mjs').Redactor} redactor
 */
export async function writeCapture(directory, label, capture, redactor) {
  assertCaptureLabel(label);
  redactor.learn(capture);
  const source = JSON.stringify(redactor.clean(capture), null, 2) + '\n';
  const { path, handle, reservation } = await claim(directory, label);
  try {
    await handle.writeFile(source, 'utf8');
    await handle.close();
    const { hits } = redactor.scan(await readFile(path, 'utf8'));
    if (hits.length > 0)
      throw new Error(`capture rejected: ${hits.map(({ kind }) => kind).join(', ')}`);
    return path;
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(path);
    throw error;
  } finally {
    await unlink(reservation);
  }
}
