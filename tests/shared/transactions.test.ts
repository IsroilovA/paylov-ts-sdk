import { describe, expect, it } from 'vitest';

import { decodePayload } from '../../src/core/decoding.js';
import { readParams } from '../../src/core/params.js';
import {
  decodeTransactionReference,
  readTransactionLookup,
  type TransactionLookup,
} from '../../src/shared/transactions.js';
import { expectInputError, expectMalformed } from '../helpers/asserts.js';

const TRANSACTION_ID = '5eed0000-0000-4000-8000-000000000001';
const CONTEXT = { endpoint: 'POST /merchant/payment/hold/', httpStatus: 200 };

function decode(payload: unknown): unknown {
  return decodePayload({ payload, context: CONTEXT }, 'result', decodeTransactionReference);
}

function lookup(value: unknown): TransactionLookup {
  return readTransactionLookup(readParams(value, 'holds.get'));
}

describe('readTransactionLookup', () => {
  it('returns only the key given, ready to send', () => {
    expect(lookup({ transactionId: TRANSACTION_ID, externalId: undefined })).toStrictEqual({
      transactionId: TRANSACTION_ID,
    });
    expect(lookup({ externalId: 'booking-1' })).toStrictEqual({ externalId: 'booking-1' });
  });

  it('requires exactly one key', async () => {
    for (const value of [{}, { transactionId: TRANSACTION_ID, externalId: 'booking-1' }]) {
      await expectInputError(() => lookup(value), { field: undefined, rule: 'exclusive' });
    }
  });
});

describe('decodeTransactionReference', () => {
  it('decodes the transactionId string as sent and nothing else', async () => {
    expect(decode({ transactionId: 'order-1', extra: 1 })).toStrictEqual({
      transactionId: 'order-1',
    });
    await expectMalformed(() => decode({ transactionId: 42 }), 'result.transactionId');
  });
});
