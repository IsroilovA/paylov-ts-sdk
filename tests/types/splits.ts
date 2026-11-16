/** Compile-time contracts for `client.splits`. */

import {
  type CreateSplitParams,
  type PaylovClient,
  type SplitRecipient,
  type SplitRecipientStatus,
  type SplitShare,
  type TransactionReference,
} from '../../src/index.js';

declare const client: PaylovClient;
const transactionId = '5eed0000-0000-4000-8000-000000000001';
const recipient = { recipientId: 'seller', amountTiyin: 100_000 } satisfies SplitRecipient;
const createParams = { transactionId, recipients: [recipient] } satisfies CreateSplitParams;

const created: Promise<TransactionReference> = client.splits.create(createParams);
void client.splits.create({ ...createParams, resendOfd: true });
// @ts-expect-error resendOfd is a boolean
void client.splits.create({ ...createParams, resendOfd: 'yes' });
// @ts-expect-error recipient amounts are tiyin fields
void client.splits.create({ ...createParams, recipients: [{ ...recipient, amount: 1 }] });
void created;

const shares: Promise<readonly SplitShare[]> = client.splits.get({ transactionId });
void shares.then(([share]) => {
  const raw: string | undefined = share?.createdAtRaw;
  const status: SplitRecipientStatus | undefined = share?.status;
  const unknownStatus: SplitRecipientStatus = 'pending';
  void [raw, status, unknownStatus];
});
