import {
  optionalEntry,
  tashkentDateTimeOf,
  type FakeRequest,
  type FakeSpecTable,
} from '../core/fake.js';
import type { Params } from '../core/params.js';
import {
  decodeReceiptItem,
  encodeFiscalReceipt,
  encodeTransactionReference,
} from '../shared/fake.js';
import { ENDPOINTS, type SplitsResource } from './resource.js';
import type {
  CreateSplitParams,
  GetSplitParams,
  ResendSplitReceiptParams,
  Split,
  SplitReceiptRecipient,
  SplitReceiptResent,
  SplitRecipient,
} from './types.js';

/** The receipt entry follows the shares. */
function encodeSplit(split: Split): unknown {
  const shares = split.shares.map((share) => ({
    recipientId: share.recipientId,
    amount: share.amountTiyin,
    status: share.status,
    createdAt: tashkentDateTimeOf(share.createdAt, 'createdAt'),
  }));
  const ofd = split.receipt === null ? {} : encodeFiscalReceipt(split.receipt);
  return [...shares, { ofd }];
}

/** Recipient amounts travel in tiyin. */
function decodeRecipient(recipient: Params): SplitRecipient {
  return {
    recipientId: recipient.string('recipientId'),
    amountTiyin: recipient.tiyin('amount'),
    ...optionalEntry('items', recipient.optionalArray('items', decodeReceiptItem)),
  };
}

function encodeSplitReceiptResent(resent: SplitReceiptResent): unknown {
  return { transactionId: resent.transactionId, status: resent.status };
}

function decodeReceiptRecipient(recipient: Params): SplitReceiptRecipient {
  return {
    ...decodeRecipient(recipient),
    items: recipient.array('items', decodeReceiptItem),
  };
}

function decodeCreateRequest({ body }: FakeRequest): CreateSplitParams {
  return {
    transactionId: body.string('transactionId'),
    recipients: body.array('recipients', decodeRecipient),
  };
}

function decodeResendReceiptRequest({ body }: FakeRequest): ResendSplitReceiptParams {
  return {
    transactionId: body.string('transactionId'),
    recipients: body.array('recipients', decodeReceiptRecipient),
  };
}

/** `resendOFD: true` marks a resend; a split sends no such flag. */
function isResend({ body }: FakeRequest): boolean {
  return body.optionalBoolean('resendOFD') === true;
}

function decodeGetRequest({ query }: FakeRequest): GetSplitParams {
  return { transactionId: query.string('transactionId') };
}

export const SPLIT_FAKES: FakeSpecTable<SplitsResource> = {
  create: {
    endpoint: ENDPOINTS.create,
    encode: encodeTransactionReference,
    decodeRequest: decodeCreateRequest,
    matches: (request) => !isResend(request),
  },
  resendReceipt: {
    endpoint: ENDPOINTS.resendReceipt,
    encode: encodeSplitReceiptResent,
    decodeRequest: decodeResendReceiptRequest,
    matches: isResend,
  },
  get: {
    endpoint: ENDPOINTS.get,
    encode: encodeSplit,
    decodeRequest: decodeGetRequest,
  },
};
