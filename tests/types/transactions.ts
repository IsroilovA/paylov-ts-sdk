/** Compile-time contracts of `client.transactions`. */

import {
  readRefundState,
  type PaylovClient,
  type FiscalReceiptSummary,
  type Transaction,
  type TransactionPage,
  type TransactionStatus,
} from '../../src/index.js';

declare const client: PaylovClient;
const transactionId = '5eed0000-0000-4000-8000-000000000001';

const transaction: Transaction = await client.transactions.get({ transactionId });
{
  const status: TransactionStatus = transaction.status;
  const known: boolean =
    status === 'held' || status === 'paid' || status === 'failed' || status === 'refunded';
  const passthrough: TransactionStatus = 'reversed';
  const at: Date = transaction.paidOrCreatedAt;
  const cancelledAt: Date | null = transaction.cancelledAt;
  const receipts: readonly FiscalReceiptSummary[] = transaction.fiscalReceipts;
  const declineCode: string | null = transaction.declineCode;
  void [known, passthrough, at, cancelledAt, receipts, declineCode];
  // @ts-expect-error the cardholder name is withheld
  void transaction.owner;
  // @ts-expect-error the float SUM amount is withheld; read amountTiyin
  void transaction.amount;
  // @ts-expect-error REST reads return the merchant account as {}, so it is withheld
  void transaction.account;
  const receiptAt: Date | undefined = receipts[0]?.issuedAt;
  void receiptAt;
  // @ts-expect-error the receipt time is a Date, not raw text
  void receipts[0]?.issuedAtRaw;
}
// @ts-expect-error a miss throws, so get never returns null
const missing: null = await client.transactions.get({ transactionId });
void missing;
// @ts-expect-error get needs a transactionId
void client.transactions.get({});

const firstPage: TransactionPage = await client.transactions.list();
const total: number = firstPage.total;
void total;
void client.transactions.list({ fromDate: '2026-11-01', toDate: '2026-11-30', page: 2 });
// @ts-expect-error dates are YYYY-MM-DD strings
void client.transactions.list({ fromDate: new Date() });
// @ts-expect-error the list has no status filter; it holds paid rows only
void client.transactions.list({ status: 'paid' });

const rrn: string = await client.transactions.getRrn({ transactionId });
void rrn;

void readRefundState({ transaction });
// @ts-expect-error a missing transaction is a transaction_not_found error, never a null read
void readRefundState({ transaction: null });
