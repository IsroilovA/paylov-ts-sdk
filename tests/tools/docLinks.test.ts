import { expect, it } from 'vitest';

import { anchorsOf, docLinkProblems } from '../../scripts/checkDocLinks.mjs';

const TARGETS: Readonly<Record<string, string>> = {
  'docs/paylov/errors.md': '# Errors\n\n## `data` shapes\n\n## Notes\n\n## Notes\n',
  'docs/usage/setup.md': '# Setup\n\n## Client lifecycle\n',
  'docs/architecture.md': '# Architecture\n',
  'src/client.ts': '',
  'package.json': '{}',
};

/** Checks `documents` in a repository of `TARGETS` and `documents`, directories included. */
function problemsOf(documents: Readonly<Record<string, string>>): string[] {
  const files: Readonly<Record<string, string>> = { ...TARGETS, ...documents };
  const paths = new Set(
    Object.keys(files).flatMap((path) =>
      path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')),
    ),
  );
  return docLinkProblems({
    documents: new Map(Object.entries(documents)),
    exists: (path) => paths.has(path.replace(/\/$/, '')),
    markdownOf: (path) => files[path],
    shipped: ['dist', 'docs/usage', 'README.md'],
  });
}

it('derives GitHub anchors from heading text, code included, with repeat suffixes', () => {
  const markdown = [
    '# Fields of `transactions[]`',
    '## Item Object (inside `items`)',
    '### [Linked](https://example.com) heading',
    '## Notes',
    '## Notes',
    '```sh',
    '# not a heading',
    '```',
  ].join('\n');
  expect([...anchorsOf(markdown)]).toEqual([
    'fields-of-transactions',
    'item-object-inside-items',
    'linked-heading',
    'notes',
    'notes-1',
  ]);
});

it('accepts existing files, directories, anchors and external URLs', () => {
  const problems = problemsOf({
    'docs/paylov/cards.md': [
      '[errors](errors.md#data-shapes), [repeat](errors.md#notes-1), [self](#cards)',
      '[source](../../src/client.ts#L10), [dir](../usage/), [site](https://developer.paylov.uz/)',
      '# Cards',
    ].join('\n'),
  });
  expect(problems).toEqual([]);
});

it('reports missing files, missing headings and links out of the repository', () => {
  const problems = problemsOf({
    'docs/paylov/cards.md': '[a](holds.md) [b](errors.md#missing) [c](#missing) [d](../../../x.md)',
  });
  expect(problems).toEqual([
    'docs/paylov/cards.md: holds.md names a missing file',
    'docs/paylov/cards.md: errors.md#missing names a missing heading',
    'docs/paylov/cards.md: #missing names a missing heading',
    'docs/paylov/cards.md: ../../../x.md leaves the repository',
  ]);
});

it('reports reference-style definitions like inline links', () => {
  expect(problemsOf({ 'docs/runbook.md': '[setup]: usage/setup.md#missing\n' })).toEqual([
    'docs/runbook.md: usage/setup.md#missing names a missing heading',
  ]);
});

it('ignores links inside fenced and inline code', () => {
  const markdown = '`[a](missing.md)`\n\n```md\n[b](missing.md)\n```\n';
  expect(problemsOf({ 'docs/paylov/cards.md': markdown })).toEqual([]);
});

it('reports shipped Markdown linking to unshipped files', () => {
  const problems = problemsOf({
    'README.md': '[setup](docs/usage/setup.md#client-lifecycle) [arch](docs/architecture.md)',
    'docs/usage/setup.md': '# Setup\n\n## Client lifecycle\n\n[pkg](../../package.json)',
  });
  expect(problems).toEqual(['README.md: docs/architecture.md names an unshipped file']);
});
