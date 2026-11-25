/**
 * Sandbox test data and card binding for the live lanes. Values are read at runtime and held in
 * memory only: cards from `PAYLOV_LIVE_TEST_CARDS` (`PAN:YYMM:OTP` entries separated by `;`), or
 * else the "Test Cards" panel of the public `sandbox.paylov.uz` bundle; the test PINFL always from
 * that panel. No PAN, expiry, OTP or PINFL is ever committed, logged or put into an assertion
 * message.
 */

import { isPaylovApiError, type Card, type PaylovClient } from '../../src/index.js';
import { parseTestCards, type SandboxTestCard } from '../../scripts/sandboxConfig.mjs';
import { env, liveUserId, note } from '../helpers/live.js';

type Loaded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const SANDBOX_UI = 'https://sandbox.paylov.uz/';
// Matches the bundle's card literals: {pan:`…`,expiry:`…`,otp:…,pinfl:`…`,…}
const BUNDLE_CARD = /\{pan:`(\d{16})`,expiry:`(\d{4})`,otp:(\d{4,6}),pinfl:`(\d{14})`/g;
/** Uzcard issues `8600` numbers; DEV approves any Uzcard amount, while Humo declines at random. */
const UZCARD_PREFIX = '8600';

function fromEnv(value: string): Loaded<readonly SandboxTestCard[]> {
  const cards = parseTestCards(value);
  return typeof cards === 'string' ? { ok: false, reason: cards } : { ok: true, value: cards };
}

interface BundleCard extends SandboxTestCard {
  readonly pinfl: string;
}

async function readBundleCards(): Promise<Loaded<readonly BundleCard[]>> {
  try {
    const html = await (await fetch(SANDBOX_UI, { signal: AbortSignal.timeout(15_000) })).text();
    const src = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
    if (src === undefined) return { ok: false, reason: 'the sandbox SPA has no module script' };
    const bundle = await (
      await fetch(new URL(src, SANDBOX_UI), { signal: AbortSignal.timeout(30_000) })
    ).text();
    const cards = [...bundle.matchAll(BUNDLE_CARD)].map((match) => ({
      pan: match[1] ?? '',
      expiry: match[2] ?? '',
      otp: match[3] ?? '',
      pinfl: match[4] ?? '',
    }));
    return cards.length > 0
      ? { ok: true, value: cards }
      : { ok: false, reason: 'the sandbox SPA bundle lists no test cards' };
  } catch {
    return { ok: false, reason: `${SANDBOX_UI} is unreachable` };
  }
}

let bundleCards: Promise<Loaded<readonly BundleCard[]>> | undefined;

/** Fetches the public sandbox bundle once per run. */
function fromBundle(): Promise<Loaded<readonly BundleCard[]>> {
  bundleCards ??= readBundleCards();
  return bundleCards;
}

async function findUzcard(): Promise<Loaded<SandboxTestCard>> {
  const variable = env('PAYLOV_LIVE_TEST_CARDS');
  const cards = variable === undefined ? await fromBundle() : fromEnv(variable);
  if (!cards.ok) return cards;
  const uzcard = cards.value.find((card) => card.pan.startsWith(UZCARD_PREFIX));
  return uzcard === undefined
    ? { ok: false, reason: 'no Uzcard (8600) test card is available' }
    : { ok: true, value: uzcard };
}

async function loadUzcard(): Promise<Loaded<SandboxTestCard>> {
  const card = await findUzcard();
  if (!card.ok) note(`skipped lanes that need a test card: ${card.reason}`);
  return card;
}

let loaded: Promise<Loaded<SandboxTestCard>> | undefined;

/** Loads the Uzcard test card once per run; a failure is one printed skip reason. */
export function uzcardTestCard(): Promise<Loaded<SandboxTestCard>> {
  loaded ??= loadUzcard();
  return loaded;
}

export interface BoundCard {
  readonly card: Card;
  readonly userId: string;
  /** Deletes the card; a card that is already gone counts as deleted. */
  readonly release: () => Promise<void>;
}

/** Binds the test card for `lane`'s own user (start, then confirm with its fixed OTP). */
export async function bindTestCard(
  client: PaylovClient,
  testCard: SandboxTestCard,
  lane: string,
): Promise<BoundCard> {
  const userId = liveUserId(lane);
  const started = await client.cards.startPanBinding({
    userId,
    cardNumber: testCard.pan,
    cardExpiry: testCard.expiry,
  });
  const card = await client.cards.confirmPanBinding({ cardId: started.cardId, otp: testCard.otp });
  note(`${lane}: bound the Uzcard test card`);
  return {
    card,
    userId,
    release: async () => {
      try {
        await client.cards.delete({ cardId: card.cardId });
      } catch (error) {
        if (!isPaylovApiError(error, 'card_not_found')) throw error;
      }
    },
  };
}

async function loadPinfl(): Promise<Loaded<string>> {
  const cards = await fromBundle();
  if (!cards.ok) {
    note(`skipped lanes that need the test PINFL: ${cards.reason}`);
    return cards;
  }
  const uzcard = cards.value.find((card) => card.pan.startsWith(UZCARD_PREFIX));
  if (uzcard === undefined) {
    note('skipped lanes that need the test PINFL: the bundle lists no Uzcard test card');
    return { ok: false, reason: 'no Uzcard test card in the bundle' };
  }
  return { ok: true, value: uzcard.pinfl };
}

let loadedPinfl: Promise<Loaded<string>> | undefined;

/** The PINFL the sandbox bundle lists with its Uzcard test card, loaded once per run. */
export function sandboxTestPinfl(): Promise<Loaded<string>> {
  loadedPinfl ??= loadPinfl();
  return loadedPinfl;
}
