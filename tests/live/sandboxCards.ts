/**
 * Sandbox test cards and card binding for the write lanes. Cards are read at runtime and held in
 * memory only: `PAYLOV_LIVE_TEST_CARDS` (`PAN:YYMM:OTP` entries separated by `;`), or else the
 * "Test Cards" panel of the public `sandbox.paylov.uz` bundle. No PAN, expiry or OTP is ever
 * committed, logged or put into an assertion message.
 */

import { isRecord } from '../../src/core/decoding.js';
import { isPaylovApiError, type Card, type PaylovClient } from '../../src/index.js';
import { parseTestCards, type SandboxTestCard } from '../../scripts/sandboxConfig.mjs';
import { env, liveUserId, note } from '../helpers/live.js';

type Loaded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const SANDBOX_UI = 'https://sandbox.paylov.uz/';
// Matches the bundle's card literals: {pan:`…`,expiry:`…`,otp:…,pinfl:`…`,…}
const BUNDLE_CARD = /\{pan:`(\d{16})`,expiry:`(\d{4})`,otp:(\d{4,6}),/g;
/** Uzcard issues `8600` numbers; DEV approves any Uzcard amount, while Humo declines at random. */
const UZCARD_PREFIX = '8600';

function fromEnv(value: string): Loaded<readonly SandboxTestCard[]> {
  const cards = parseTestCards(value);
  return typeof cards === 'string' ? { ok: false, reason: cards } : { ok: true, value: cards };
}

async function fromBundle(): Promise<Loaded<readonly SandboxTestCard[]>> {
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
    }));
    return cards.length > 0
      ? { ok: true, value: cards }
      : { ok: false, reason: 'the sandbox SPA bundle lists no test cards' };
  } catch {
    return { ok: false, reason: `${SANDBOX_UI} is unreachable` };
  }
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

/** One public Card Bind call; throws with the HTTP status and code only. */
async function postCardBind(
  baseUrl: string,
  token: string,
  step: string,
  body: Readonly<Record<string, string>>,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await fetch(`${baseUrl}/public/cardBind/${encodeURIComponent(token)}/${step}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  const result = isRecord(payload) ? payload['result'] : undefined;
  if (response.ok && isRecord(result)) return result;
  const error = isRecord(payload) ? payload['error'] : undefined;
  const code = isRecord(error) ? String(error['code']) : 'no code';
  throw new Error(`public cardBind ${step} answered HTTP ${response.status} ${code}`);
}

/**
 * Completes a Card Bind link the way its hosted page does, through the gateway's public bind
 * calls: a DEV `bindUrl` opens the production page, which cannot complete a DEV link. Returns
 * the bound card id.
 */
export async function completeCardBind(
  baseUrl: string,
  token: string,
  testCard: SandboxTestCard,
): Promise<string> {
  await postCardBind(baseUrl, token, 'create/', {
    cardNumber: testCard.pan,
    expireDate: testCard.expiry,
  });
  const { card } = await postCardBind(baseUrl, token, 'confirm/', { otp: testCard.otp });
  const cardId = isRecord(card) ? card['cardId'] : undefined;
  if (typeof cardId !== 'string') throw new Error('public cardBind confirm returned no card id');
  return cardId;
}
