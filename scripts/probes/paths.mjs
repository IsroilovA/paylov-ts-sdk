import { execFileSync } from 'node:child_process';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { env } from '../sandboxConfig.mjs';
import { ProbeError } from './probeError.mjs';

export const repositoryRoot = resolve(import.meta.dirname, '../..');

/** The default capture directory: inside the checkout, accepted only while git ignores it. */
export const repositoryCaptures = resolve(repositoryRoot, 'captures');

/** @param {unknown} error @param {string} code */
export function hasErrorCode(error, code) {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Resolves existing ancestors too, so symlinks cannot hide a repository descendant.
 * @param {string} path
 * @returns {Promise<string>}
 */
async function realDestination(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    const parent = dirname(path);
    return resolve(await realDestination(parent), relative(parent, path));
  }
}

/** @param {string} path @returns {Promise<string>} */
export async function outsideRepository(path) {
  const target = await realDestination(resolve(path));
  const fromRoot = relative(await realpath(repositoryRoot), target);
  const escapesRoot = fromRoot === '..' || fromRoot.startsWith('../') || isAbsolute(fromRoot);
  if (!escapesRoot) throw new ProbeError('probe files must stay outside the repository');
  return target;
}

/** Whether git ignores files inside `directory`, tracked or not. @param {string} directory */
function ignoresFilesIn(directory) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', join(directory, '001_.json')], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** Outside the checkout, or exactly its git-ignored `captures/` directory.
 * @param {string} path @returns {Promise<string>}
 */
async function allowedCaptureTarget(path) {
  const target = await realDestination(resolve(path));
  const captures = await realDestination(repositoryCaptures);
  if (target !== captures) return outsideRepository(target);
  if (!ignoresFilesIn(target)) throw new ProbeError('captures/ must stay ignored by git');
  return target;
}

/** The probe writer and the capture audit choose the same directory: an explicit path, then
 * `PAYLOV_CAPTURE_DIR`, then {@link repositoryCaptures}.
 * @param {string | undefined} explicit
 */
function chosenCaptureDirectory(explicit) {
  const path = explicit?.trim() === '' ? undefined : explicit;
  return path ?? env('PAYLOV_CAPTURE_DIR') ?? repositoryCaptures;
}

/** The directory probes write to, created if missing and checked again after creation, so a
 * directory swapped in meanwhile is refused.
 * @param {string} [path] overrides `PAYLOV_CAPTURE_DIR`
 */
export async function captureDirectory(path) {
  const target = await allowedCaptureTarget(chosenCaptureDirectory(path));
  await mkdir(target, { recursive: true, mode: 0o700 });
  return allowedCaptureTarget(target);
}

/** The existing directory the audit reads; a missing one is an error, never created.
 * @param {string} [path] overrides `PAYLOV_CAPTURE_DIR`
 */
export async function auditedCaptureDirectory(path) {
  const target = await allowedCaptureTarget(chosenCaptureDirectory(path));
  let stats;
  try {
    stats = await stat(target);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) throw new ProbeError('capture directory does not exist');
    throw error;
  }
  if (!stats.isDirectory()) throw new ProbeError('capture path is not a directory');
  return target;
}
