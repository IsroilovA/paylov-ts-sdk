/** Compile-time contracts of `client.payments`. */

import type {
  PaylovClient,
  CreatePaymentParams,
  OtpSmsSettings,
  PanPaymentStarted,
  PaymentRefunded,
  StartPanPaymentParams,
  TransactionReference,
} from '../../src/index.js';

declare const client: PaylovClient;
declare const cardNumberFromSecureInput: string;
declare const otpFromUser: string;
const transactionId = '5eed0000-0000-4000-8000-000000000001';
const cardId = '5eed0000-0000-4000-8000-000000000002';

const createParams = {
  amountTiyin: 2_500_000,
  account: { order_id: 'A-1024', items: [1, 2], nested: { paid: false, note: null } },
} satisfies CreatePaymentParams;
const created: Promise<TransactionReference> = client.payments.create(createParams);
void created;
void client.payments.create(
  { ...createParams, userId: 'user-42' },
  { signal: AbortSignal.timeout(5_000) },
);
void client.payments.create({ amountTiyin: 100 });
// @ts-expect-error account values are JSON
void client.payments.create({ ...createParams, account: { at: new Date() } });
// @ts-expect-error money is tiyin under amountTiyin, never a SUM amount
void client.payments.create({ ...createParams, amount: 1000 });

const paid: Promise<TransactionReference> = client.payments.pay({
  transactionId,
  cardId,
  userId: 'user-42',
});
void paid;
// @ts-expect-error pay requires the user the card is bound to
void client.payments.pay({ transactionId, cardId });

const refunded: PaymentRefunded = await client.payments.refund({ transactionId });
const refundedAt: Date = refunded.refundedAt;
void refundedAt;
// @ts-expect-error there is no partial refund
void client.payments.refund({ transactionId, amountTiyin: 100 });

const startParams = {
  cardNumber: cardNumberFromSecureInput,
  cardExpiry: '9912',
  amountTiyin: 120_000,
} satisfies StartPanPaymentParams;
const started: PanPaymentStarted = await client.payments.startPanPayment(startParams);
const phone: string = started.otpSentPhone;
void phone;
// @ts-expect-error extId is not stored by Paylov, so it is not accepted
void client.payments.startPanPayment({ ...startParams, extId: 'order-1' });
// @ts-expect-error the PAN payment result carries no extId
void started.extId;
const sms: OtpSmsSettings = { hash: 'app-hash', templateId: 1 };
void client.payments.startPanPayment({ ...startParams, sms });
void client.payments.confirmPanPayment({ transactionId, otp: otpFromUser, sms: {} });
// @ts-expect-error hash is a string
void client.payments.confirmPanPayment({ transactionId, otp: otpFromUser, sms: { hash: 7 } });

const confirmed: Promise<TransactionReference> = client.payments.confirmPanPayment({
  transactionId: started.transactionId,
  otp: otpFromUser,
});
void confirmed;
// @ts-expect-error the OTP is required
void client.payments.confirmPanPayment({ transactionId });
