#!/usr/bin/env node
/** Builds a tarball view and verifies runtime plus declarations from a clean consumer. */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { report } from './report.mjs';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'paylov-sdk-package-'));
/** @type {string[]} */
const problems = [];
/** @type {Set<string>} */
let paths = new Set();

/** @param {string} command @param {string[]} args @param {string} cwd @returns {string} */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  /** @type {{ name: string, filename: string, files: { path: string }[] }[]} */
  const packed = JSON.parse(
    run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], root),
  );
  const manifest = packed[0];
  if (manifest === undefined) throw new Error('npm pack returned no package');
  paths = new Set(manifest.files.map((file) => file.path));
  const requiredFiles = [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/testing.js',
    'dist/testing.d.ts',
    'README.md',
    'package.json',
  ];
  for (const required of requiredFiles) {
    if (!paths.has(required)) problems.push(`packed package is missing ${required}`);
  }
  for (const path of paths) {
    if (/^(?:src\/|tests\/|scripts\/|docs\/(?!usage\/))/.test(path)) {
      problems.push(`packed package contains internal path ${path}`);
    }
  }

  const tarball = join(temporary, manifest.filename);
  run('tar', ['-xzf', tarball, '-C', temporary], root);
  // Testing fake canaries may appear only in the testing bundle.
  for (const path of paths) {
    if (!path.endsWith('.js') || path === 'dist/testing.js') continue;
    if (readFileSync(join(temporary, 'package', path), 'utf8').includes('EXAMPLE-FAKE-')) {
      problems.push(`${path} carries testing fake canaries`);
    }
  }
  const consumer = join(temporary, 'consumer');
  const nodeModules = join(consumer, 'node_modules');
  const installed = join(nodeModules, manifest.name);
  mkdirSync(dirname(installed), { recursive: true });
  symlinkSync(join(temporary, 'package'), installed, 'dir');
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          skipLibCheck: false,
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    ),
  );
  const example = readFileSync(join(root, 'examples/packageConsumer.ts'), 'utf8')
    .replace("from '../src/index.js'", `from '${manifest.name}'`)
    .replace("from '../src/testing.js'", `from '${manifest.name}/testing'`);
  writeFileSync(join(consumer, 'consumer.ts'), example);
  run(resolve(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], consumer);
  run(process.execPath, ['consumer.ts'], consumer);
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

report(
  'check:package',
  problems,
  `${paths.size} packed files; declarations and ESM runtime verified`,
);
