/** Compile-time contracts for `client.fiscalization`. */

import {
  type PaylovClient,
  type ActivityTypeCheck,
  type CheckActivityTypeParams,
  type FiscalReceipt,
  type FiscalReceiptItem,
  type FiscalReceiptRegistered,
  type FiscalReceiptRefunded,
  type GetFiscalReceiptParams,
  type RegisterFiscalReceiptParams,
  type TransactionLookup,
} from '../../src/index.js';

declare const client: PaylovClient;
declare const item: FiscalReceiptItem;
const transactionId = '5eed0000-0000-4000-8000-000000000001';

const cardParams: RegisterFiscalReceiptParams = { transactionId, items: [item] };
const card: Promise<FiscalReceiptRegistered> = client.fiscalization.registerReceipt(cardParams);
const cash: RegisterFiscalReceiptParams = {
  externalId: 'cash-0001',
  phoneNumber: '+998900000000',
  items: [item],
};
// @ts-expect-error a card payment and a cash sale are exclusive
const both: RegisterFiscalReceiptParams = { ...cash, transactionId };
// @ts-expect-error a cash sale needs the customer's phone
const cashWithoutPhone: RegisterFiscalReceiptParams = { externalId: 'cash-0001', items: [item] };
// @ts-expect-error the phone belongs to cash sales only
const cardWithPhone: RegisterFiscalReceiptParams = { ...cardParams, phoneNumber: '+998900000000' };
void [card, cash, both, cashWithoutPhone, cardWithPhone];

const lookup: TransactionLookup = { transactionId };
const found: Promise<FiscalReceipt | null> = client.fiscalization.getReceipt({
  ...lookup,
  isRefund: true,
});
const byExternalId: GetFiscalReceiptParams = { externalId: 'cash-0001', transactionId: undefined };
// @ts-expect-error a lookup takes exactly one identifier
void client.fiscalization.getReceipt({ ...lookup, externalId: 'cash-0001' });
// @ts-expect-error a lookup needs an identifier
void client.fiscalization.getReceipt({ isRefund: false });
void [found, byExternalId];

const attached: Promise<void> = client.fiscalization.attachReceipt({
  transactionId,
  terminalId: 'EP000000000378',
  issuedAtRaw: '20260915143025',
  fiscalSign: '947030008479',
  receiptUrl: 'https://ofd.soliq.uz/epi?t=EP000000000378&r=173723',
  receiptId: 173723,
});
void attached;

const refunded: Promise<FiscalReceiptRefunded> = client.fiscalization.refundReceipt({
  receiptId: 184595,
});
void refunded;

const checkParams: CheckActivityTypeParams = {
  pinfl: '12345678901234',
  activityType: 'high_income',
};
const check: Promise<ActivityTypeCheck> = client.fiscalization.checkActivityType(checkParams);
// @ts-expect-error activity types are named, not the wire numbers
void client.fiscalization.checkActivityType({ ...checkParams, activityType: 3 });
void check.then((result) => {
  const confirmed: boolean = result.isConfirmed;
  // @ts-expect-error isConfirmed is the answer for every type; there is no separate income flag
  void result.incomeStatus;
  return confirmed;
});
