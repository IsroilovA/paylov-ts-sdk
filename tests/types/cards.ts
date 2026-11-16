/** Compile-time contracts for `client.cards`. */

import {
  PaylovClient,
  type Card,
  type CardBindSession,
  type CardBindStatus,
  type CardProcessing,
  type DeleteCardParams,
  type GetCardParams,
  type StartPanBindingParams,
} from '../../src/index.js';

const client = new PaylovClient({
  baseUrl: 'https://gateway.example',
  consumerKey: 'EXAMPLE-CONSUMER-KEY-NOT-A-REAL-CREDENTIAL',
  consumerSecret: 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL',
  username: 'EXAMPLE-USERNAME-NOT-A-REAL-CREDENTIAL',
  password: 'EXAMPLE-PASSWORD-NOT-A-REAL-CREDENTIAL',
});
const cardId = '5eed0000-0000-4000-8000-000000000001';

export async function bindSessionNarrowsOnBound(token: string): Promise<string | undefined> {
  const session: CardBindSession = await client.cards.getBindSession({ token });
  if (session.isBound) {
    const confirmed: 'confirmed' = session.status;
    void confirmed;
    const card: Card = session.card;
    return card.cardId;
  }
  const status: CardBindStatus = session.status;
  void status;
  const none: null = session.card;
  void none;
  // @ts-expect-error an unbound session has no card
  void session.card.cardId;
  return undefined;
}

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

export const withSms = {
  ...startParams,
  sms: { hash: 'app-hash', templateId: 1 },
} satisfies StartPanBindingParams;
// @ts-expect-error templateId is an integer
export const textTemplateId: StartPanBindingParams = { ...startParams, sms: { templateId: '1' } };

export async function removalResolvesVoid(): Promise<void> {
  const removal: Promise<void> = client.cards.delete(
    { cardId },
    { signal: AbortSignal.timeout(5_000) },
  );
  await removal;
  // @ts-expect-error a bind link expiry is a Date
  const expiresAt: string = (await client.cards.createBindLink({ userId: 'user-42' })).expiresAt;
  void expiresAt;
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

export const deleteParams = { cardId } satisfies DeleteCardParams;

// @ts-expect-error a card is deleted by its id, not by the wire userCardId
export const wireDeleteKey: DeleteCardParams = { ...deleteParams, userCardId: cardId };
