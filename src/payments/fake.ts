import {
  optionalEntry,
  tashkentDateTimeOf,
  decodeWholeSum,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
import type { Params } from '../core/params.js';
import type { PaylovJsonObject } from '../core/types.js';
import { decodeOtpSms, encodeTransactionReference } from '../shared/fake.js';
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
    ...optionalEntry('sms', body.optionalObject('sms', decodeOtpSms)),
  };
}

function decodeConfirmPanPaymentRequest({ body }: FakeRequest): ConfirmPanPaymentParams {
  return {
    transactionId: body.string('transactionId'),
    otp: body.string('otp'),
    ...optionalEntry('sms', body.optionalObject('sms', decodeOtpSms)),
  };
}

export function createPaymentsFake(
  script: Scripter<'payments', PaymentsResource>,
): PaylovFakeSurface<PaymentsResource> {
  return {
    create: script(
      'payments.create',
      ENDPOINTS.create,
      encodeTransactionReference,
      decodeCreateRequest,
    ),
    pay: script('payments.pay', ENDPOINTS.pay, encodeTransactionReference, decodePayRequest),
    refund: script('payments.refund', ENDPOINTS.refund, encodePaymentRefunded, decodeRefundRequest),
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
