// The optional `sms` object of PAN binding and payment without registration. Paylov lists the
// field without a description [OPEN Q29], so the SDK checks only types and forwards it unchanged.

import type { Params } from '../core/params.js';

/**
 * Optional OTP SMS settings, forwarded to Paylov unchanged. Paylov does not document what they
 * change; its test environment behaved the same with and without them.
 */
export interface OtpSmsSettings {
  readonly hash?: string;
  /** An integer; Paylov answers `validation_error` otherwise. */
  readonly templateId?: number;
}

/** The wire form; undefined keys are left out of the JSON body. */
interface WireOtpSms {
  readonly hash: string | undefined;
  readonly templateId: number | undefined;
}

/** Reads `sms`; use with `params.optionalObject`. */
export function readOtpSms(sms: Params): WireOtpSms {
  return { hash: sms.optionalString('hash'), templateId: sms.optionalInteger('templateId') };
}
