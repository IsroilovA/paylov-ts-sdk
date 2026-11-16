import {
  optionalEntry,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
import { decodeReceiptItem } from '../shared/fake.js';
import { readTransactionLookup } from '../shared/transactions.js';
import {
  ACTIVITY_TYPES,
  ENDPOINTS,
  WIRE_ACTIVITY_TYPES,
  type FiscalizationResource,
} from './resource.js';
import type {
  ActivityTypeCheck,
  AttachFiscalReceiptParams,
  CheckActivityTypeParams,
  FiscalReceipt,
  FiscalReceiptRefunded,
  FiscalReceiptRegistered,
  GetFiscalReceiptParams,
  RefundFiscalReceiptParams,
  RegisterFiscalReceiptParams,
} from './types.js';

function encodeOfdReceipt(receipt: FiscalReceiptRegistered): Record<string, unknown> {
  return {
    receiptId: receipt.receiptId,
    receiptUrl: receipt.receiptUrl,
    terminalId: receipt.terminalId,
    fiscalSign: receipt.fiscalSign,
  };
}

function encodeRegistered(receipt: FiscalReceiptRegistered): unknown {
  return { ofd: encodeOfdReceipt(receipt) };
}

/**
 * A known transaction without a receipt answers `success: false`. An unknown `externalId` answers
 * the endpoint's miss instead, which the SDK reads as the same `null`.
 */
function encodeReceiptLookup(receipt: FiscalReceipt | null): unknown {
  if (receipt === null) return { success: false, receiptUrl: null, isRefund: null };
  return { success: true, ...encodeOfdReceipt(receipt), isRefund: receipt.isRefund };
}

function encodeAttached(): unknown {
  return { success: true, error: null };
}

function encodeRefunded(refunded: FiscalReceiptRefunded): unknown {
  return {
    ofd: { refund: encodeOfdReceipt(refunded.refund) },
    sale: encodeOfdReceipt(refunded.sale),
  };
}

/** Activity names make the high-income answer; none is the self-employed `data: null`. */
function encodeActivityTypeCheck(check: ActivityTypeCheck): unknown {
  const { isConfirmed, activityNames } = check;
  return activityNames.length > 0
    ? { success: true, data: { status: isConfirmed, activityNames } }
    : { success: isConfirmed, data: null };
}

function decodeRegisterRequest({ body }: FakeRequest): RegisterFiscalReceiptParams {
  const items = body.array('items', decodeReceiptItem);
  const lookup = readTransactionLookup(body);
  return lookup.transactionId === undefined
    ? { externalId: lookup.externalId, phoneNumber: body.string('phoneNumber'), items }
    : { transactionId: lookup.transactionId, items };
}

function decodeGetRequest({ query }: FakeRequest): GetFiscalReceiptParams {
  const refunded = query.optionalString('refunded');
  return {
    ...readTransactionLookup(query),
    ...optionalEntry('isRefund', refunded === undefined ? undefined : refunded === 'true'),
  };
}

function decodeAttachRequest({ body }: FakeRequest): AttachFiscalReceiptParams {
  return {
    transactionId: body.string('transactionId'),
    terminalId: body.string('terminalId'),
    issuedAtRaw: body.string('dateTime'),
    fiscalSign: body.string('fiscalSign'),
    receiptUrl: body.string('qrCodeUrl'),
    receiptId: body.integer('receiptId'),
    ...optionalEntry('externalId', body.optionalString('externalId')),
  };
}

function decodeRefundRequest({ body }: FakeRequest): RefundFiscalReceiptParams {
  return { receiptId: body.integer('receiptId') };
}

function decodeActivityTypeRequest({ body }: FakeRequest): CheckActivityTypeParams {
  const wire = body.integer('activityType');
  const activityType = ACTIVITY_TYPES.find((type) => WIRE_ACTIVITY_TYPES[type] === wire);
  if (activityType === undefined) throw new TypeError('activityType is not a known wire value');
  return { pinfl: body.string('pinfl'), activityType };
}

export function createFiscalizationFake(
  script: Scripter<'fiscalization', FiscalizationResource>,
): PaylovFakeSurface<FiscalizationResource> {
  return {
    registerReceipt: script(
      'fiscalization.registerReceipt',
      ENDPOINTS.registerReceipt,
      encodeRegistered,
      decodeRegisterRequest,
    ),
    getReceipt: script(
      'fiscalization.getReceipt',
      ENDPOINTS.getReceipt,
      encodeReceiptLookup,
      decodeGetRequest,
    ),
    attachReceipt: script(
      'fiscalization.attachReceipt',
      ENDPOINTS.attachReceipt,
      encodeAttached,
      decodeAttachRequest,
    ),
    refundReceipt: script(
      'fiscalization.refundReceipt',
      ENDPOINTS.refundReceipt,
      encodeRefunded,
      decodeRefundRequest,
    ),
    checkActivityType: script(
      'fiscalization.checkActivityType',
      ENDPOINTS.checkActivityType,
      encodeActivityTypeCheck,
      decodeActivityTypeRequest,
    ),
  };
}
