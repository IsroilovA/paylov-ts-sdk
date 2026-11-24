import { execFileSync } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

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

/** Checks the path again after creation, so a directory swapped in meanwhile is refused.
 * @param {string | undefined} path defaults to {@link repositoryCaptures}
 */
export async function captureDirectory(path) {
  const chosen = path === undefined || path.trim() === '' ? repositoryCaptures : path;
  const target = await allowedCaptureTarget(chosen);
  await mkdir(target, { recursive: true, mode: 0o700 });
  return allowedCaptureTarget(target);
}
