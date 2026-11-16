import { describe, expect, it } from 'vitest';

import { architectureProblems, importAllowed } from '../../scripts/checkArchitecture.mjs';
import { dependencyProblems } from '../../scripts/checkDependencies.mjs';
import { importsOfSource } from '../../scripts/sourceImports.mjs';

describe('layer rules', () => {
  it.each([
    ['core/money.ts', '../client.js'],
    ['cards/resource.ts', '../holds/resource.js'],
    ['cards/resource.ts', '../core/auth.js'],
    ['cards/resource.ts', '../core/http.js'],
    ['cards/resource.ts', '../core/config.js'],
    ['cards/resource.ts', '../core/envelope.js'],
    ['cards/resource.ts', '../core/lifecycle.js'],
    ['cards/resource.ts', '../testing/gateway.js'],
    ['cards/resource.ts', '../../scripts/report.mjs'],
    ['shared/receiptItems.ts', '../core/http.js'],
    ['shared/receiptItems.ts', '../core/call.js'],
    ['shared/receiptItems.ts', '../cards/types.js'],
    ['checkout/link.ts', '../core/http.js'],
    ['checkout/link.ts', '../core/config.js'],
    ['checkout/link.ts', '../core/decoding.js'],
    ['webhooks/decode.ts', '../core/envelope.js'],
    ['webhooks/decode.ts', '../core/lifecycle.js'],
    ['onboarding/client.ts', '../core/auth.js'],
    ['onboarding/client.ts', '../core/lifecycle.js'],
    ['onboarding/client.ts', '../core/envelope.js'],
    ['onboarding/client.ts', '../shared/receiptItems.js'],
    ['core/decoding.ts', './http.js'],
    ['core/money.ts', './call.js'],
    ['client.ts', './index.js'],
    ['client.ts', './testing.js'],
    ['client.ts', './testing/gateway.js'],
    ['testing.ts', './cards/fake.js'],
    ['index.ts', './testing.js'],
    ['index.ts', './testing/gateway.js'],
  ])('forbids %s to import %s', (from, specifier) => {
    expect(importAllowed(from, specifier, false)).toBe(false);
  });

  it.each([
    ['cards/resource.ts', './fake.js'],
    ['cards/resource.ts', '../core/fake.js'],
    ['payments/resource.ts', '../shared/fake.js'],
    ['shared/transactions.ts', './fake.js'],
    ['core/http.ts', './fake.js'],
    ['index.ts', './core/fake.js'],
  ])('lets %s name the types of %s but never load it', (from, specifier) => {
    expect(importAllowed(from, specifier, false)).toBe(true);
    expect(importAllowed(from, specifier, true)).toBe(false);
  });

  it.each([
    ['onboarding/client.ts', '../core/http.js'],
    ['onboarding/client.ts', '../core/config.js'],
    ['onboarding/client.ts', '../core/call.js'],
    ['cards/resource.ts', '../core/call.js'],
    ['cards/resource.ts', '../shared/receiptItems.js'],
    ['checkout/link.ts', '../core/params.js'],
    ['webhooks/decode.ts', '../core/params.js'],
    ['shared/receiptItems.ts', '../core/params.js'],
    ['core/money.ts', './errorCodes.js'],
    ['core/http.ts', './lifecycle.js'],
    ['testing/gateway.ts', '../client.js'],
    ['testing/gateway.ts', '../cards/fake.js'],
    ['testing.ts', './testing/gateway.js'],
    ['client.ts', './cards/resource.js'],
  ])('lets %s load %s', (from, specifier) => {
    expect(importAllowed(from, specifier, true)).toBe(true);
  });
});

function exists(): boolean {
  return true;
}

describe('architecture problems', () => {
  it('reports forbidden imports and runtime imports in types modules', () => {
    const imports = new Map([
      [
        'cards/types.ts',
        importsOfSource('types.ts', "import { isTiyin } from '../core/money.js';"),
      ],
      [
        'holds/types.ts',
        importsOfSource('types.ts', "import type { Tiyin } from '../core/money.js';"),
      ],
      [
        'cards/resource.ts',
        importsOfSource('resource.ts', "export * from '../holds/resource.js';"),
      ],
    ]);
    expect(architectureProblems({ exists, imports }).problems).toEqual([
      'src/cards/types.ts has a runtime import of ../core/money.js',
      'src/cards/resource.ts may not import ../holds/resource.js',
    ]);
  });

  it('reports a missing required path of a surface', () => {
    const { problems } = architectureProblems({
      exists: (path) => path !== 'src/checkout/link.ts',
      imports: new Map(),
    });
    expect(problems).toEqual(['checkout is missing src/checkout/link.ts']);
  });
});

describe('runtime dependencies', () => {
  const packageJson = { name: 'paylov-ts-sdk', devDependencies: { typescript: '*' } };

  it.each([
    "import 'typescript';",
    "import ts, { type CompilerOptions } from 'typescript';",
    "export { version } from 'typescript';",
    "void import('typescript');",
    'void import(packageName);',
  ])('rejects runtime development dependencies through %s', (source) => {
    const imports = new Map([['src/core/http.ts', importsOfSource('http.ts', source)]]);
    expect(dependencyProblems({ packageJson, imports })).toEqual([
      expect.stringMatching(/^src\/core\/http\.ts has a forbidden runtime dependency: /),
    ]);
  });

  it('allows type-only, built-in and relative imports', () => {
    const source = [
      "import type { CompilerOptions } from 'typescript';",
      "export type { Program } from 'typescript';",
      "import { hash } from 'node:crypto';",
      "import { send } from './call.js';",
    ].join('\n');
    const imports = new Map([['src/core/http.ts', importsOfSource('http.ts', source)]]);
    expect(dependencyProblems({ packageJson, imports })).toEqual([]);
  });

  it.each([
    ['dependencies', { typescript: '*' }],
    ['optionalDependencies', { typescript: '*' }],
    ['bundledDependencies', ['typescript']],
  ])('rejects runtime package metadata in %s', (field, value) => {
    expect(
      dependencyProblems({ packageJson: { ...packageJson, [field]: value }, imports: new Map() }),
    ).toEqual([`runtime dependency fields present: ${field}`]);
  });
});
