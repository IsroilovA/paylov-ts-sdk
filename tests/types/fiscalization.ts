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
} from '../../src/index.js';

declare const client: PaylovClient;
declare const item: FiscalReceiptItem;
const transactionId = '5eed0000-0000-4000-8000-000000000001';

const cardParams: RegisterFiscalReceiptParams = { transactionId, items: [item] };
const card: Promise<FiscalReceiptRegistered> = client.fiscalization.registerReceipt(cardParams);
// @ts-expect-error only card payments are fiscalized; there is no cash sale
const cash: RegisterFiscalReceiptParams = { externalId: 'cash-0001', items: [item] };
// @ts-expect-error a receipt needs its card payment
const withoutPayment: RegisterFiscalReceiptParams = { items: [item] };
void [card, cash, withoutPayment];

const getParams: GetFiscalReceiptParams = { transactionId, isRefund: true };
const found: Promise<FiscalReceipt | null> = client.fiscalization.getReceipt(getParams);
// @ts-expect-error a receipt is read by its card payment's transactionId only
void client.fiscalization.getReceipt({ externalId: 'cash-0001' });
// @ts-expect-error a lookup needs the transactionId
void client.fiscalization.getReceipt({ isRefund: false });
// @ts-expect-error receipts registered elsewhere cannot be attached
void client.fiscalization.attachReceipt;
void found;

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
