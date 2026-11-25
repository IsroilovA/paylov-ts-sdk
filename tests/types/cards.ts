/** Compile-time contracts for `client.cards`. */

import type {
  Card,
  CardProcessing,
  DeleteCardParams,
  GetCardParams,
  PanBindingStarted,
  PaylovClient,
  StartPanBindingParams,
} from '../../src/index.js';
import type { IsEqual } from './exact.js';

declare const client: PaylovClient;
const cardId = '5eed0000-0000-4000-8000-000000000001';

export async function phoneCheckAnswersBoolean(): Promise<boolean> {
  return client.cards.checkPhone({ cardId, phoneNumber: '+998900000000' });
}

export const startParams = {
  userId: 'user-42',
  cardNumber: 'PAN-FROM-SECURE-INPUT',
  cardExpiry: '9912',
} satisfies StartPanBindingParams;

const { cardExpiry, ...withoutExpiry } = startParams;
void cardExpiry;
// @ts-expect-error the expiry is required
export const missingExpiry: StartPanBindingParams = withoutExpiry;

// @ts-expect-error the SDK sends no OTP SMS settings
export const withSms: StartPanBindingParams = { ...startParams, sms: { templateId: 1 } };

export async function bindCard(otp: string): Promise<readonly Card[]> {
  const started: PanBindingStarted = await client.cards.startPanBinding(startParams);
  const confirmed: Promise<Card> = client.cards.confirmPanBinding({ cardId: started.cardId, otp });
  void confirmed;
  const cards = await client.cards.list({ userId: startParams.userId });
  // @ts-expect-error the list is read-only
  void cards.push;
  return cards;
}

export async function removalResolvesVoid(): Promise<void> {
  const removal: Promise<void> = client.cards.delete(
    { cardId },
    { signal: AbortSignal.timeout(5_000) },
  );
  await removal;
}

export async function cardStateIsFlat(params: GetCardParams): Promise<boolean> {
  const card = await client.cards.get(params);
  const processing: CardProcessing = card.processing;
  void processing;
  // @ts-expect-error the card state is flat, not a nested status object
  const { status }: { readonly status: unknown } = card;
  void status;
  return card.isActive && card.isSmsEnabled && card.processingStatus === 'active';
}

// A miss throws, so get resolves exactly a card, never null.
export const getResolvesCard: IsEqual<
  Awaited<ReturnType<PaylovClient['cards']['get']>>,
  Card
> = true;

export const deleteParams = { cardId } satisfies DeleteCardParams;

// @ts-expect-error a card is deleted by its id, not by the wire userCardId
export const wireDeleteKey: DeleteCardParams = { ...deleteParams, userCardId: cardId };
