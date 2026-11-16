import {
  optionalEntry,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
import type { Params } from '../core/params.js';
import { decodeReceiptItem, encodeTransactionReference } from '../shared/fake.js';
import { ENDPOINTS, type SplitsResource } from './resource.js';
import type { CreateSplitParams, GetSplitParams, SplitRecipient, SplitShare } from './types.js';

function encodeSplitShares(shares: readonly SplitShare[]): unknown {
  return shares.map((share) => ({
    recipientId: share.recipientId,
    amount: share.amountTiyin,
    status: share.status,
    createdAt: share.createdAtRaw,
  }));
}

/** Recipient amounts travel in tiyin. */
function decodeRecipient(recipient: Params): SplitRecipient {
  return {
    recipientId: recipient.string('recipientId'),
    amountTiyin: recipient.tiyin('amount'),
    ...optionalEntry('items', recipient.optionalArray('items', decodeReceiptItem)),
  };
}

function decodeCreateRequest({ body }: FakeRequest): CreateSplitParams {
  return {
    transactionId: body.string('transactionId'),
    recipients: body.array('recipients', decodeRecipient),
    ...optionalEntry('resendOfd', body.optionalBoolean('resendOFD')),
  };
}

function decodeGetRequest({ query }: FakeRequest): GetSplitParams {
  return { transactionId: query.string('transactionId') };
}

export function createSplitsFake(
  script: Scripter<'splits', SplitsResource>,
): PaylovFakeSurface<SplitsResource> {
  return {
    create: script(
      'splits.create',
      ENDPOINTS.create,
      encodeTransactionReference,
      decodeCreateRequest,
    ),
    get: script('splits.get', ENDPOINTS.get, encodeSplitShares, decodeGetRequest),
  };
}
