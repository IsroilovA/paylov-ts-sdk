import {
  optionalEntry,
  tashkentDateTimeOf,
  decodeWholeSum,
  type FakeRequest,
  type FakeSpecTable,
} from '../core/fake.js';
import type { Params } from '../core/params.js';
import type { PaylovJsonObject } from '../core/types.js';
import { encodeTransactionReference } from '../shared/fake.js';
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

/** The SDK sends no `extId`, which the gateway then echoes as `null`; `code` is always `null` (W c178). */
function encodePanPaymentStarted(started: PanPaymentStarted): unknown {
  return {
    ...encodeTransactionReference(started),
    otpSentPhone: started.otpSentPhone,
    extId: null,
    code: null,
  };
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

export const PAYMENT_FAKES: FakeSpecTable<PaymentsResource> = {
  create: {
    endpoint: ENDPOINTS.create,
    encode: encodeTransactionReference,
    decodeRequest: decodeCreateRequest,
  },
  pay: {
    endpoint: ENDPOINTS.pay,
    encode: encodeTransactionReference,
    decodeRequest: decodePayRequest,
  },
  refund: {
    endpoint: ENDPOINTS.refund,
    encode: encodePaymentRefunded,
    decodeRequest: decodeRefundRequest,
  },
  startPanPayment: {
    endpoint: ENDPOINTS.startPanPayment,
    encode: encodePanPaymentStarted,
    decodeRequest: decodeStartPanPaymentRequest,
  },
  confirmPanPayment: {
    endpoint: ENDPOINTS.confirmPanPayment,
    encode: encodeTransactionReference,
    decodeRequest: decodeConfirmPanPaymentRequest,
  },
};
