#!/usr/bin/env node
/**
 * Checks relative links in maintained Markdown: each target exists, each `#anchor` names a heading
 * of its Markdown target, and shipped Markdown links only to shipped files. External URLs and links
 * inside code are not checked; `docs/vendor/` is a link target only.
 */

import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

import { report } from './report.mjs';

const checked = ['*.md', '{docs,src,tests,.agents}/**/*.md'];
/** Vendor pages are mirrored verbatim; `CLAUDE.md` files are symlinks to the adjacent `AGENTS.md`. */
const unchecked = ['docs/vendor/**', '**/CLAUDE.md'];

/**
 * GitHub's heading anchors: lowercased text without punctuation, spaces as hyphens, and `-1`, `-2`
 * suffixes on repeats. Headings inside code fences do not count.
 * @param {string} markdown @returns {Set<string>}
 */
export function anchorsOf(markdown) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {Set<string>} */
  const anchors = new Set();
  for (const line of unfencedLinesOf(markdown)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const slug = heading
      .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}\s_-]/gu, '')
      .replaceAll(/\s/g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

/** Lines outside fenced code blocks. @param {string} markdown */
function unfencedLinesOf(markdown) {
  /** @type {string[]} */
  const lines = [];
  let fence = '';
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined && (fence === '' || marker.startsWith(fence))) {
      fence = fence === '' ? marker : '';
      continue;
    }
    if (fence === '') lines.push(line);
  }
  return lines;
}

/** Relative inline and reference-definition link targets outside code. @param {string} markdown */
function relativeTargetsOf(markdown) {
  const prose = unfencedLinesOf(markdown).map((line) => line.replaceAll(/(`+)[^`]*?\1/g, ''));
  const inline = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  const definition = /^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/g;
  return prose
    .flatMap((line) => [...line.matchAll(inline), ...line.matchAll(definition)])
    .flatMap(([, target]) =>
      target === undefined || /^[a-z][a-z\d+.-]*:/i.test(target) ? [] : [target],
    );
}

/**
 * @typedef {object} Repository
 * @property {(path: string) => boolean} exists whether a repository-relative file or directory
 *   exists
 * @property {(path: string) => string | undefined} markdownOf the content of a Markdown target
 * @property {(path: string) => boolean} isShipped whether the package ships the path
 */

/**
 * The problem with one relative link of `file`, if any.
 * @param {string} file @param {string} target @param {Repository} repository
 * @returns {string | undefined}
 */
function linkProblemOf(file, target, { exists, markdownOf, isShipped }) {
  const [pathPart = '', anchor] = target.split('#', 2);
  const path = pathPart === '' ? file : normalize(join(dirname(file), decodeURI(pathPart)));
  const where = `${file}: ${target}`;
  if (path.startsWith('..')) return `${where} leaves the repository`;
  if (!exists(path)) return `${where} names a missing file`;
  if (isShipped(file) && !isShipped(path)) return `${where} names an unshipped file`;
  if (anchor === undefined || !path.endsWith('.md')) return undefined;
  return anchorsOf(markdownOf(path) ?? '').has(anchor)
    ? undefined
    : `${where} names a missing heading`;
}

/**
 * Broken relative links, missing anchors, and links from shipped Markdown to unshipped files.
 * @param {object} input
 * @param {ReadonlyMap<string, string>} input.documents repository-relative path to content
 * @param {Repository['exists']} input.exists
 * @param {Repository['markdownOf']} input.markdownOf
 * @param {readonly string[]} input.shipped package.json `files` entries; `package.json` always ships
 * @returns {string[]}
 */
export function docLinkProblems({ documents, exists, markdownOf, shipped }) {
  const isShipped = (/** @type {string} */ path) =>
    path === 'package.json' ||
    shipped.some((entry) => path === entry || path.startsWith(`${entry}/`));
  const repository = { exists, markdownOf, isShipped };
  return [...documents]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([file, markdown]) =>
      relativeTargetsOf(markdown).flatMap(
        (target) => linkProblemOf(file, target, repository) ?? [],
      ),
    );
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const read = (/** @type {string} */ path) => readFileSync(join(root, path), 'utf8');
  const paths = globSync(checked, { cwd: root, exclude: unchecked }).toSorted();
  const documents = new Map(paths.map((path) => [path, read(path)]));
  const { files: shipped } = JSON.parse(read('package.json'));
  const problems = docLinkProblems({
    documents,
    exists: (path) => existsSync(join(root, path)),
    markdownOf: (path) => documents.get(path) ?? read(path),
    shipped,
  });
  report('check:docs', problems, `relative links in ${documents.size} Markdown files resolve`);
}
