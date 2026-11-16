/**
 * Wire encoders of the shared transaction shapes and request decoders of the shared request
 * shapes, the inverses of `transactions.ts`, `receiptItems.ts` and `otpSms.ts`.
 */

import { optionalEntry } from '../core/fake.js';
import type { Params } from '../core/params.js';
import type { OtpSmsSettings } from './otpSms.js';
import type { FiscalReceiptItem } from './receiptItems.js';
import type { TransactionReference } from './transactions.js';

/** The wire `{ transactionId }` that `decodeTransactionReference` reads. */
export function encodeTransactionReference(reference: TransactionReference): {
  readonly transactionId: string;
} {
  return { transactionId: reference.transactionId };
}

/**
 * The first wire spelling `statusDecoder(statusByWire)` reads as `status`; a status the SDK does
 * not rename passes through. Throws `TypeError` for a wire spelling the SDK never returns, which
 * would read back renamed.
 */
export function encodeStatus(statusByWire: ReadonlyMap<string, string>, status: string): string {
  for (const [wire, sdkStatus] of statusByWire) if (sdkStatus === status) return wire;
  if (statusByWire.has(status)) {
    throw new TypeError(
      `status ${status} is a wire spelling; the SDK reads it as ${String(statusByWire.get(status))}`,
    );
  }
  return status;
}

/** A receipt line as `readReceiptItem` sent it. */
export function decodeReceiptItem(item: Params): FiscalReceiptItem {
  const base = {
    title: item.string('title'),
    priceTiyin: item.tiyin('price'),
    ...optionalEntry('discountTiyin', item.optionalTiyin('discount')),
    count: item.integer('count'),
    code: item.string('code'),
    vatPercent: item.integer('vat_percent'),
    packageCode: item.string('package_code'),
  };
  return item.exclusive(['tin', 'pinfl']) === 'tin'
    ? { ...base, tin: item.string('tin') }
    : { ...base, pinfl: item.string('pinfl') };
}

/** The `sms` object as `readOtpSms` sent it. */
export function decodeOtpSms(sms: Params): OtpSmsSettings {
  return {
    ...optionalEntry('hash', sms.optionalString('hash')),
    ...optionalEntry('templateId', sms.optionalInteger('templateId')),
  };
}
