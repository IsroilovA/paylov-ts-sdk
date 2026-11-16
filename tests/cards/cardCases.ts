import { createCardsResource, type CardsResource } from '../../src/cards/resource.js';
import type { Card } from '../../src/cards/types.js';
import { recordOf } from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { patchedResponse } from '../helpers/fixtures.js';
import { setupResource, type ResourceHarness } from '../helpers/testHttp.js';

// Values shared by the card suites; ids follow the cards/ fixtures.
export const PAN = 'PAN-FROM-SECURE-INPUT';
export const OTP = 'OTP-ENTERED-BY-CARDHOLDER';
export const EXPIRY = '9912';
export const PINFL = '12345678901234';
export const PHONE = '+998900000000';
export const UZCARD_ID = '5eed0000-0000-4000-8000-000000000001';
export const HUMO_ID = '5eed0000-0000-4000-8000-000000000002';
export const BIND_TOKEN = 'EXAMPLE-BIND-NOT-A-REAL-TOKEN';
export const OWNER = 'EXAMPLE-CARD-OWNER-NOT-A-REAL-PERSON';
export const FULL_PAN = ['8600', '0000', '0000', '0000'].join('');

/** The UZCARD as `confirmPanBinding` and `get` decode it from captures c027 and c052. */
export const UZCARD: Card = {
  cardId: UZCARD_ID,
  userId: 'user-example-1',
  holderName: OWNER,
  cardName: 'SDK UZ',
  maskedCardNumber: '860000******0000',
  balanceTiyin: 1_000_000_000,
  bankId: '38',
  bankName: 'Paylov Bank',
  vendor: 'Uzcard',
  processing: 'Uzcard',
  isActive: true,
  processingStatus: 'active',
  isSmsEnabled: true,
};

export function setup(
  script: FakeResponseSpec[],
): ResourceHarness<CardsResource> & { cards: CardsResource } {
  const harness = setupResource(createCardsResource, script);
  return { ...harness, cards: harness.resource };
}

/** A wire fixture with `patch` applied to the card at `result.card`. */
export function withCard(fixture: string, patch: Record<string, unknown>): FakeResponseSpec {
  return patchedResponse(fixture, ['result', 'card'], (card) => ({ ...card, ...patch }));
}

export function bodyKeys(call: { body?: unknown } | undefined): string[] {
  return Object.keys(recordOf(call?.body));
}
