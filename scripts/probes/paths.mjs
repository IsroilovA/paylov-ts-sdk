import { mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { ProbeError } from './probeError.mjs';

export const repositoryRoot = resolve(import.meta.dirname, '../..');

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

/** Checks the path again after creation, so a directory swapped in meanwhile is refused.
 * @param {string | undefined} path
 */
export async function captureDirectory(path) {
  if (path === undefined || path.trim() === '')
    throw new ProbeError('PAYLOV_CAPTURE_DIR is required');
  const target = await outsideRepository(path);
  await mkdir(target, { recursive: true, mode: 0o700 });
  return outsideRepository(target);
}
