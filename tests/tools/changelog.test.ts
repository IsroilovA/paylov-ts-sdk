import { expect, it } from 'vitest';

import { releaseNotes } from '../../scripts/checkChangelog.mjs';

const REPOSITORY_URL = 'https://github.com/owner/repo';

function changelog(...sections: readonly string[]): string {
  return [
    '# Changelog',
    '',
    ...sections,
    '[1.1.0]: https://github.com/owner/repo/releases/tag/v1.1.0',
    '[1.0.0]: https://github.com/owner/repo/releases/tag/v1.0.0',
    '',
  ].join('\n');
}

const CURRENT = '## [1.1.0] - 2026-11-16\n\n### Added\n\n- `newMethod`.\n';
const PREVIOUS = '## [1.0.0] - 2026-10-01\n\n- Initial release.\n';

it('extracts only the version section, between its heading and the next one', () => {
  const result = releaseNotes({
    changelog: changelog('## [Unreleased]\n\n- Pending.\n', CURRENT, PREVIOUS),
    version: '1.1.0',
    repositoryUrl: REPOSITORY_URL,
  });
  expect(result).toEqual({ notes: '### Added\n\n- `newMethod`.', problems: [] });
});

it('ends the last section at the release links', () => {
  const result = releaseNotes({
    changelog: changelog(PREVIOUS),
    version: '1.0.0',
    repositoryUrl: REPOSITORY_URL,
  });
  expect(result).toEqual({ notes: '- Initial release.', problems: [] });
});

it.each([
  ['an unreleased version', changelog(CURRENT), '1.2.0', "no '## [1.2.0] - YYYY-MM-DD' heading"],
  ['an undated heading', changelog('## [1.1.0]\n\n- Entry.\n'), '1.1.0', "no '## [1.1.0] - "],
  [
    'an impossible date',
    changelog('## [1.1.0] - 2026-02-30\n\n- Entry.\n'),
    '1.1.0',
    'heading date is not YYYY-MM-DD: 2026-02-30',
  ],
  ['an empty section', changelog('## [1.1.0] - 2026-11-16\n\n', PREVIOUS), '1.1.0', 'is empty'],
  [
    'a missing release link',
    changelog('## [1.2.0] - 2026-11-16\n\n- Entry.\n', CURRENT),
    '1.2.0',
    'missing release link: [1.2.0]: https://github.com/owner/repo/releases/tag/v1.2.0',
  ],
])('reports %s', (_case, text, version, problem) => {
  const { problems } = releaseNotes({ changelog: text, version, repositoryUrl: REPOSITORY_URL });
  expect(problems).toEqual([expect.stringContaining(problem)]);
});
