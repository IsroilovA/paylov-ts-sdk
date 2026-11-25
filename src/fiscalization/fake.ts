import {
  optionalEntry,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
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

function encodeRegistered(receipt: FiscalReceiptRegistered): unknown {
  return { ofd: encodeRegisteredReceipt(receipt) };
}

/** A known transaction without a receipt answers `success: false`. */
function encodeReceiptLookup(receipt: FiscalReceipt | null): unknown {
  if (receipt === null) return { success: false, receiptUrl: null, isRefund: null };
  return { success: true, ...encodeFiscalReceipt(receipt) };
}

function encodeRefunded(refunded: FiscalReceiptRefunded): unknown {
  return {
    ofd: { refund: encodeRegisteredReceipt(refunded.refund) },
    sale: encodeRegisteredReceipt(refunded.sale),
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
  return {
    transactionId: body.string('transactionId'),
    items: body.array('items', decodeReceiptItem),
  };
}

function decodeGetRequest({ query }: FakeRequest): GetFiscalReceiptParams {
  const refunded = query.optionalString('refunded');
  return {
    transactionId: query.string('transactionId'),
    ...optionalEntry('isRefund', refunded === undefined ? undefined : refunded === 'true'),
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
