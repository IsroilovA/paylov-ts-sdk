import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { loadFixture } from './helpers/fixtures.js';

const ROOT = fileURLToPath(new URL('fixtures/', import.meta.url));
const FIXTURES = readdirSync(ROOT, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join('/'))
  .toSorted();

it.each(FIXTURES)('%s has the format of its provenance suffix', (path) => {
  expect(() => loadFixture(path)).not.toThrow();
});
