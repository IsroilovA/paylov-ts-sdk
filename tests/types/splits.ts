/** Compile-time contracts for `client.splits`. */

import {
  type CreateSplitParams,
  type FiscalReceipt,
  type FiscalReceiptItem,
  type PaylovClient,
  type ResendSplitReceiptParams,
  type Split,
  type SplitReceiptResent,
  type SplitReceiptStatus,
  type SplitRecipient,
  type SplitRecipientStatus,
  type SplitShare,
  type TransactionReference,
} from '../../src/index.js';
import type { IsEqual } from './exact.js';

declare const client: PaylovClient;
declare const items: readonly FiscalReceiptItem[];
const transactionId = '5eed0000-0000-4000-8000-000000000001';
const recipient = { recipientId: 'seller', amountTiyin: 100_000 } satisfies SplitRecipient;
const createParams = { transactionId, recipients: [recipient] } satisfies CreateSplitParams;

const created: Promise<TransactionReference> = client.splits.create(createParams);
// @ts-expect-error resending a receipt is splits.resendReceipt, not a create option
void client.splits.create({ ...createParams, resendOfd: true });
// @ts-expect-error recipient amounts are tiyin fields
void client.splits.create({ ...createParams, recipients: [{ ...recipient, amount: 1 }] });
void created;

const resendParams = {
  transactionId,
  recipients: [{ ...recipient, items }],
} satisfies ResendSplitReceiptParams;
void client.splits.resendReceipt(resendParams).then((resent: SplitReceiptResent) => {
  const status: SplitReceiptStatus = resent.status;
  const unknownStatus: SplitReceiptStatus = 'queued';
  void [status, unknownStatus];
  // @ts-expect-error the OFD's raw diagnostic text is not exposed
  void resent.lastOfdError;
});
// A recipient without items may stand beside one with items.
void client.splits.resendReceipt({
  transactionId,
  recipients: [recipient, { ...recipient, items }],
});

const split: Promise<Split> = client.splits.get({ transactionId });
void split.then((found) => {
  const share: SplitShare | undefined = found.shares[0];
  const createdAt: Date | undefined = share?.createdAt;
  const status: SplitRecipientStatus | undefined = share?.status;
  const unknownStatus: SplitRecipientStatus = 'pending';
  const receipt: FiscalReceipt | null = found.receipt;
  void [createdAt, status, unknownStatus, receipt];
});
// A missing split throws split_not_found, so get resolves exactly a split, never null.
const getResolvesSplit: IsEqual<Awaited<ReturnType<PaylovClient['splits']['get']>>, Split> = true;
void getResolvesSplit;
