import {
  optionalEntry,
  tashkentDateTimeOf,
  decodeWholeSum,
  type FakeCodec,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
import type { Params } from '../core/params.js';
import type { PaylovJsonObject } from '../core/types.js';
import { encodeTransactionReference } from '../shared/fake.js';
import type { TransactionReference } from '../shared/transactions.js';
import { ENDPOINTS, type PaymentsResource } from './resource.js';
import type {
  ConfirmPanPaymentParams,
  CreatePaymentParams,
  PanPaymentStarted,
  PaymentRefunded,
  PayPaymentParams,
  RefundPaymentParams,
  StartPanPaymentParams,
} from './types.js';

function encodePaymentRefunded(refund: PaymentRefunded): unknown {
  return {
    ...encodeTransactionReference(refund),
    status: 'cancelled',
    cancelTime: tashkentDateTimeOf(refund.refundedAt, 'refundedAt'),
  };
}

function encodePanPaymentStarted(started: PanPaymentStarted): unknown {
  return { ...encodeTransactionReference(started), otpSentPhone: started.otpSentPhone };
}

/** An absent `account` is sent as `{}`, so an empty one reads as absent. */
function decodeAccount(body: Params): { readonly account?: PaylovJsonObject } {
  const account = body.json('account');
  return optionalEntry('account', Object.keys(account).length === 0 ? undefined : account);
}

function decodeCreateRequest({ body }: FakeRequest): CreatePaymentParams {
  return {
    amountTiyin: decodeWholeSum(body, 'amount'),
    ...decodeAccount(body),
    ...optionalEntry('userId', body.optionalString('userId')),
  };
}

function decodePayRequest({ body }: FakeRequest): PayPaymentParams {
  return {
    transactionId: body.string('transactionId'),
    cardId: body.string('cardId'),
    userId: body.string('userId'),
  };
}

function decodeRefundRequest({ body }: FakeRequest): RefundPaymentParams {
  return { transactionId: body.string('transactionId') };
}

function decodeStartPanPaymentRequest({ body }: FakeRequest): StartPanPaymentParams {
  return {
    cardNumber: body.string('cardNumber'),
    cardExpiry: body.string('expireDate'),
    amountTiyin: decodeWholeSum(body, 'amount'),
    ...decodeAccount(body),
  };
}

function decodeConfirmPanPaymentRequest({ body }: FakeRequest): ConfirmPanPaymentParams {
  return {
    transactionId: body.string('transactionId'),
    otp: body.string('otp'),
  };
}

export const PAYMENT_CODECS: {
  readonly create: FakeCodec<TransactionReference, CreatePaymentParams>;
  readonly pay: FakeCodec<TransactionReference, PayPaymentParams>;
  readonly refund: FakeCodec<PaymentRefunded, RefundPaymentParams>;
} = {
  create: { encode: encodeTransactionReference, decodeRequest: decodeCreateRequest },
  pay: { encode: encodeTransactionReference, decodeRequest: decodePayRequest },
  refund: { encode: encodePaymentRefunded, decodeRequest: decodeRefundRequest },
};

export function createPaymentsFake(
  script: Scripter<'payments', PaymentsResource>,
): PaylovFakeSurface<PaymentsResource> {
  return {
    create: script(
      'payments.create',
      ENDPOINTS.create,
      PAYMENT_CODECS.create.encode,
      PAYMENT_CODECS.create.decodeRequest,
    ),
    pay: script(
      'payments.pay',
      ENDPOINTS.pay,
      PAYMENT_CODECS.pay.encode,
      PAYMENT_CODECS.pay.decodeRequest,
    ),
    refund: script(
      'payments.refund',
      ENDPOINTS.refund,
      PAYMENT_CODECS.refund.encode,
      PAYMENT_CODECS.refund.decodeRequest,
    ),
    startPanPayment: script(
      'payments.startPanPayment',
      ENDPOINTS.startPanPayment,
      encodePanPaymentStarted,
      decodeStartPanPaymentRequest,
    ),
    confirmPanPayment: script(
      'payments.confirmPanPayment',
      ENDPOINTS.confirmPanPayment,
      encodeTransactionReference,
      decodeConfirmPanPaymentRequest,
    ),
  };
}
