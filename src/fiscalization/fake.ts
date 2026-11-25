import { optionalEntry, type FakeRequest, type FakeSpecTable } from '../core/fake.js';
import { decodeReceiptItem, encodeFiscalReceipt, encodeRegisteredReceipt } from '../shared/fake.js';
import type { FiscalReceipt, FiscalReceiptRegistered } from '../shared/fiscalReceipts.js';
import {
  ACTIVITY_TYPES,
  ENDPOINTS,
  WIRE_ACTIVITY_TYPES,
  type FiscalizationResource,
} from './resource.js';
import type {
  ActivityTypeCheck,
  CheckActivityTypeParams,
  FiscalReceiptRefunded,
  GetFiscalReceiptParams,
  RefundFiscalReceiptParams,
  RegisterFiscalReceiptParams,
} from './types.js';

function encodeFiscalReceiptRegistered(receipt: FiscalReceiptRegistered): unknown {
  return { ofd: encodeRegisteredReceipt(receipt) };
}

/** A known transaction without a receipt answers `success: false`. */
function encodeReceiptLookup(receipt: FiscalReceipt | null): unknown {
  if (receipt === null) return { success: false, receiptUrl: null, isRefund: null };
  return { success: true, ...encodeFiscalReceipt(receipt) };
}

function encodeFiscalReceiptRefunded(refunded: FiscalReceiptRefunded): unknown {
  return {
    ofd: { refund: encodeRegisteredReceipt(refunded.refund) },
    sale: encodeRegisteredReceipt(refunded.sale),
  };
}

/**
 * The high-income object for anything but a bare negative, since only its `data.status` confirms
 * every activity type alike; a bare negative is the recorded `success: false, data: null`.
 */
function encodeActivityTypeCheck(check: ActivityTypeCheck): unknown {
  const { isConfirmed, activityNames } = check;
  return isConfirmed || activityNames.length > 0
    ? { success: true, data: { status: isConfirmed, activityNames } }
    : { success: false, data: null };
}

function decodeRegisterReceiptRequest({ body }: FakeRequest): RegisterFiscalReceiptParams {
  return {
    transactionId: body.string('transactionId'),
    items: body.array('items', decodeReceiptItem),
  };
}

function decodeGetReceiptRequest({ query }: FakeRequest): GetFiscalReceiptParams {
  const refunded = query.optionalString('refunded');
  return {
    transactionId: query.string('transactionId'),
    ...optionalEntry('isRefund', refunded === undefined ? undefined : refunded === 'true'),
  };
}

function decodeRefundReceiptRequest({ body }: FakeRequest): RefundFiscalReceiptParams {
  return { receiptId: body.integer('receiptId') };
}

function decodeCheckActivityTypeRequest({ body }: FakeRequest): CheckActivityTypeParams {
  const wire = body.integer('activityType');
  const activityType = ACTIVITY_TYPES.find((type) => WIRE_ACTIVITY_TYPES[type] === wire);
  if (activityType === undefined) throw new TypeError('activityType is not a known wire value');
  return { pinfl: body.string('pinfl'), activityType };
}

export const FISCALIZATION_FAKES: FakeSpecTable<FiscalizationResource> = {
  registerReceipt: {
    endpoint: ENDPOINTS.registerReceipt,
    encode: encodeFiscalReceiptRegistered,
    decodeRequest: decodeRegisterReceiptRequest,
  },
  getReceipt: {
    endpoint: ENDPOINTS.getReceipt,
    encode: encodeReceiptLookup,
    decodeRequest: decodeGetReceiptRequest,
  },
  refundReceipt: {
    endpoint: ENDPOINTS.refundReceipt,
    encode: encodeFiscalReceiptRefunded,
    decodeRequest: decodeRefundReceiptRequest,
  },
  checkActivityType: {
    endpoint: ENDPOINTS.checkActivityType,
    encode: encodeActivityTypeCheck,
    decodeRequest: decodeCheckActivityTypeRequest,
  },
};
