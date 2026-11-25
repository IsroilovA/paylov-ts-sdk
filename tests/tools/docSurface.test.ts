import { expect, it } from 'vitest';

import { docSurfaceProblems } from '../../scripts/checkDocSurface.mjs';

/** A minimal documented surface, independent of the repository's evolving docs. */
const SOURCES: Readonly<Record<string, string>> = {
  'index.ts': [
    "export { PaylovClient } from './client.js';",
    "export { PaylovOnboarding } from './onboarding/client.js';",
    "export { formatSum, type Money } from './core/money.js';",
    "export type { CardsResource } from './cards/resource.js';",
  ].join('\n'),
  'client.ts': `
import type { CardsResource } from './cards/resource.js';
export class PaylovClient {
  /** Cards. */
  readonly cards: CardsResource;
  /**
   * Closes the client.
   * @example await paylov.close();
   */
  async close(): Promise<void> {}
  #secret(): void {}
}
`,
  'cards/resource.ts': `
export interface CardsResource {
  /**
   * Reads one card.
   * @example await paylov.cards.get({ cardId });
   */
  get(params: unknown): Promise<unknown>;
  /**
   * Lists cards.
   * @example await paylov.cards.list({ userId });
   */
  list(params: unknown): Promise<unknown>;
}
export function createCardsResource(): CardsResource {
  throw new Error('unused');
}
`,
  'onboarding/client.ts': `
export class PaylovOnboarding {
  /**
   * Checks a token.
   * @example await onboarding.checkToken({ token });
   */
  checkToken(): void {}
}
`,
  'webhooks/receiver.ts': `
export class PaylovWebhookReceiver {
  /**
   * Decodes a webhook.
   * @example receiver.receive(request);
   */
  receive(): void {}
}
`,
  'testing.ts': [
    "export { PaylovFakeGateway } from './testing/gateway.js';",
    "export { createWebhookRequest } from './testing/webhooks.js';",
  ].join('\n'),
  'testing/gateway.ts': `
export class PaylovFakeGateway {
  /**
   * Checks the script was used up.
   * @example fake.assertDone();
   */
  assertDone(): void {}
}
`,
};

const INDEX = `# Usage

| Export / method | Doc |
| --- | --- |
| \`new PaylovClient(config)\`, \`close\` | setup.md |
| \`paylov.cards\` — \`get\`, \`list\` | cards.md |
| \`PaylovOnboarding\` — \`checkToken\` | setup.md |
| \`PaylovWebhookReceiver\` — \`receive\` | setup.md |
| \`formatSum\` | setup.md |
| \`PaylovFakeGateway\` — \`assertDone\` | setup.md |
| \`createWebhookRequest\` | setup.md |
`;

const TOPICS = ['INDEX.md', 'setup.md', 'cards.md'];

interface Surface {
  readonly sources: ReadonlyMap<string, string>;
  readonly index: string;
  readonly topics: readonly string[];
}

function surface(): Surface {
  return { sources: new Map(Object.entries(SOURCES)), index: INDEX, topics: TOPICS };
}

/** The surface with `from` replaced by `to` in one source file, or in INDEX.md. */
function edit(file: string, from: string, to: string): Surface {
  const base = surface();
  if (file === 'INDEX.md') return { ...base, index: base.index.replace(from, to) };
  const sources = new Map(base.sources);
  sources.set(file, (sources.get(file) ?? '').replace(from, to));
  return { ...base, sources };
}

function problemsOf(input: Surface): string[] {
  return docSurfaceProblems(input).problems;
}

it('accepts a documented surface', () => {
  expect(problemsOf(surface())).toEqual([]);
});

it('rejects an undocumented runtime export', () => {
  const input = edit(
    'index.ts',
    "from './client.js';",
    "from './client.js';\nexport const undocumentedFeature = 1;",
  );
  expect(problemsOf(input)).toEqual([
    'value export not mentioned in INDEX.md: undocumentedFeature',
  ]);
});

it('rejects an undocumented testing export', () => {
  expect(problemsOf(edit('INDEX.md', '`createWebhookRequest`', '`createRequest`'))).toEqual([
    'value export not mentioned in INDEX.md: createWebhookRequest',
  ]);
});

it('rejects a namespace missing from the usage index', () => {
  expect(problemsOf(edit('INDEX.md', '`paylov.cards`', '`cards`'))).toContain(
    'namespace not mentioned in INDEX.md: paylov.cards',
  );
});

it('rejects a resource interface that is not a client namespace', () => {
  expect(problemsOf(edit('client.ts', 'readonly cards: CardsResource;', ''))).toContain(
    'cards/resource.ts: CardsResource is not a PaylovClient namespace',
  );
});

it('rejects a resource method without an example', () => {
  const input = edit(
    'cards/resource.ts',
    '@example await paylov.cards.list',
    'await paylov.cards.list',
  );
  expect(problemsOf(input)).toEqual([
    'cards/resource.ts: public method paylov.cards.list lacks @example',
  ]);
});

it('rejects a resource method missing from its index row', () => {
  expect(problemsOf(edit('INDEX.md', '`get`, `list`', '`get`'))).toEqual([
    'cards/resource.ts: method list not listed in the paylov.cards INDEX.md row',
  ]);
});

it('rejects a namespace row listing a method the namespace lacks', () => {
  expect(problemsOf(edit('INDEX.md', '`get`, `list`', '`get`, `list`, `createBindLink`'))).toEqual([
    'INDEX.md: the paylov.cards row lists createBindLink, not a method',
  ]);
});

it('checks a resource interface declared outside resource.ts', () => {
  const base = surface();
  const sources = new Map(base.sources).set(
    'cards/historyResource.ts',
    'export interface CardHistoryResource {\n  read(): void;\n}\n',
  );
  expect(problemsOf({ ...base, sources })).toEqual([
    'cards/historyResource.ts: CardHistoryResource is not a PaylovClient namespace',
    'cards/historyResource.ts: public method paylov.?.read lacks @example',
  ]);
});

it.each([
  ['client.ts', 'PaylovClient', 'close'],
  ['onboarding/client.ts', 'PaylovOnboarding', 'checkToken'],
  ['webhooks/receiver.ts', 'PaylovWebhookReceiver', 'receive'],
  ['testing/gateway.ts', 'PaylovFakeGateway', 'assertDone'],
])('checks the public methods of the class in %s', (file, name, method) => {
  expect(problemsOf(edit(file, '@example', '@remarks'))).toEqual([
    `${file}: public method ${name}.${method} lacks @example`,
  ]);
  expect(problemsOf(edit('INDEX.md', `\`${method}\``, ''))).toEqual([
    `${file}: method ${method} not listed in the ${name} INDEX.md row`,
  ]);
});

it('fails on a missing public class file', () => {
  const base = surface();
  const sources = new Map(base.sources);
  sources.delete('onboarding/client.ts');
  expect(problemsOf({ ...base, sources })).toContain('src/onboarding/client.ts is missing');
});

it('reads exports through the parser, not line text', () => {
  const input = edit(
    'index.ts',
    "from './client.js';",
    "from './client.js';\nconst url = 'https://x.test/'; export { url as afterUrl };\n// export { commentedOut };",
  );
  expect(problemsOf(input)).toEqual(['value export not mentioned in INDEX.md: afterUrl']);
});

it('rejects a broken usage topic reference', () => {
  expect(problemsOf({ ...surface(), topics: ['INDEX.md', 'setup.md'] })).toEqual([
    'INDEX.md references a missing file: docs/usage/cards.md',
  ]);
});

it('rejects a usage topic omitted from the index', () => {
  expect(problemsOf({ ...surface(), topics: [...TOPICS, 'unlisted.md'] })).toEqual([
    'topic file never referenced by INDEX.md: docs/usage/unlisted.md',
  ]);
});
