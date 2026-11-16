import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Runs `check` in a temporary checkout holding the repository's scripts, its installed packages
 * and `files`, then removes it. Scripts are copied because they resolve the checkout from their
 * own location.
 */
function withCheckout(
  files: Readonly<Record<string, string>>,
  check: (directory: string) => void,
): void {
  const directory = mkdtempSync(join(tmpdir(), 'paylov-commands-'));
  try {
    cpSync(join(REPOSITORY_ROOT, 'scripts'), join(directory, 'scripts'), { recursive: true });
    symlinkSync(join(REPOSITORY_ROOT, 'node_modules'), join(directory, 'node_modules'));
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), content);
    }
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function run(
  directory: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): SpawnSyncReturns<string> {
  const result = spawnSync(process.execPath, args, {
    cwd: directory,
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
  expect(result.error, 'the command finished').toBeUndefined();
  return result;
}

it('reports architecture problems as a failing check', () => {
  withCheckout({ 'src/core/money.ts': "import '../client.js';\n" }, (directory) => {
    const { status, stderr } = run(directory, ['scripts/checkArchitecture.mjs']);
    expect(status).toBe(1);
    expect(stderr).toContain('src/core/money.ts may not import ../client.js');
  });
});

it('reports usage index gaps as a failing check', () => {
  const files = {
    'src/index.ts': 'export const undocumented = 1;\n',
    'docs/usage/INDEX.md': '# Usage\n',
  };
  withCheckout(files, (directory) => {
    const { status, stderr } = run(directory, ['scripts/checkDocSurface.mjs']);
    expect(status).toBe(1);
    expect(stderr).toContain('value export not mentioned in INDEX.md: undocumented');
  });
});

it('reports runtime dependencies as a failing check', () => {
  const files = {
    'package.json': JSON.stringify({ dependencies: { typescript: '*' } }),
    'src/core/http.ts': "import 'typescript';\n",
  };
  withCheckout(files, (directory) => {
    const { status, stderr } = run(directory, ['scripts/checkDependencies.mjs']);
    expect(status).toBe(1);
    expect(stderr).toContain('runtime dependency fields present: dependencies');
    expect(stderr).toContain('src/core/http.ts has a forbidden runtime dependency: typescript');
  });
});

it('scans the maintained Paylov reference but not the vendor mirror', () => {
  const leak = ['```json', JSON.stringify({ card: { number: '8'.repeat(15) } }), '```'].join('\n');
  withCheckout({ 'docs/paylov/cards.md': leak, 'docs/vendor/cards.md': leak }, (directory) => {
    const { status, stderr } = run(directory, ['scripts/checkSecrets.mjs']);
    expect(status).toBe(1);
    expect(stderr).toContain('docs/paylov/cards.md: full-PAN-shaped literal in "number"');
    expect(stderr).not.toContain('docs/vendor/');
    expect(stderr).not.toContain('8'.repeat(15));
  });
});

it('keeps default tests offline even when live environment variables are set', () => {
  const files = {
    'tests/offline.test.ts':
      "import { expect, it } from 'vitest'; it('offline sentinel', () => expect(1).toBe(1));",
    'tests/live/sentinel.test.ts': "throw new Error('LIVE_SUITE_SELECTED');",
  };
  withCheckout(files, (directory) => {
    for (const file of ['package.json', 'vitest.config.ts']) {
      cpSync(join(REPOSITORY_ROOT, file), join(directory, file));
    }
    const env = { ...process.env, PAYLOV_LIVE: '1', PAYLOV_LIVE_WRITES: '1' };
    const result = run(directory, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=1'], env);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('1 passed');
    expect(result.stdout + result.stderr).not.toContain('LIVE_SUITE_SELECTED');
  });
});
