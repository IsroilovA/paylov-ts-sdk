/**
 * The only error classes this SDK throws, one per origin. Errors carry allowlisted metadata only:
 * never a request body, query value, header, gateway message, gateway `data` or raw cause,
 * because those hold passwords, card data and caller identifiers.
 */

import type { PaylovErrorCode, PaylovKnownErrorCode } from './errorCodes.js';
import type { ResponseContext } from './types.js';

/** Where a failure came from. */
export type PaylovErrorKind = 'input' | 'closed' | 'api' | 'protocol' | 'connection';

/**
 * Rejected locally, before any I/O:
 * - `sdk_invalid_input`: a method parameter broke a rule.
 * - `sdk_invalid_amount`: an amount is not a valid integer amount for that call.
 * - `sdk_config_error`: constructor configuration broke a rule.
 */
export type PaylovInputErrorCode = 'sdk_invalid_input' | 'sdk_invalid_amount' | 'sdk_config_error';

/** The rule a rejected input broke. */
export type PaylovInputRule = 'required' | 'type' | 'format' | 'range' | 'exclusive';

/**
 * - `sdk_malformed_response`: a 2xx body did not match the endpoint's documented shape.
 * - `sdk_unexpected_status`: a non-2xx without a usable error body, for example a proxy page or
 *   a bare 401/403.
 */
export type PaylovProtocolErrorCode = 'sdk_malformed_response' | 'sdk_unexpected_status';

/** `sdk_aborted`: the caller's `signal` fired; `isSent` tells whether a request had left. */
export type PaylovConnectionErrorCode = 'sdk_timeout' | 'sdk_network_error' | 'sdk_aborted';

/** The metadata `toJSON()` returns; safe to log. Details an error lacks are `undefined`. */
export interface PaylovErrorDiagnostic {
  readonly name: string;
  readonly kind: PaylovErrorKind;
  readonly code: PaylovErrorCode;
  readonly message: string;
  readonly httpStatus?: number;
  readonly endpoint?: string;
  readonly field?: string | undefined;
  readonly rule?: PaylovInputRule | undefined;
  readonly fields?: readonly string[] | undefined;
  readonly retryAfterSeconds?: number | undefined;
  readonly path?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly isSent?: boolean;
  readonly isUnsettled?: boolean;
}

type DiagnosticDetails = Omit<PaylovErrorDiagnostic, 'name' | 'kind' | 'code' | 'message'>;

/** The shared base of the five error classes; consumers use the {@link PaylovError} union. */
abstract class PaylovBaseError extends Error {
  abstract override readonly name: string;
  abstract readonly kind: PaylovErrorKind;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    Error.captureStackTrace(this, new.target);
  }

  /**
   * Returns SDK diagnostic metadata only.
   *
   * @example
   * logger.error('paylov call failed', error.toJSON());
   */
  toJSON(): PaylovErrorDiagnostic {
    return {
      name: this.name,
      kind: this.kind,
      code: this.code,
      message: this.message,
      ...this.diagnosticDetails(),
    };
  }

  protected abstract diagnosticDetails(): DiagnosticDetails;
}

interface PaylovInputErrorInit {
  readonly code: PaylovInputErrorCode;
  readonly message: string;
  readonly field: string | undefined;
  readonly rule: PaylovInputRule;
}

/**
 * The SDK rejected a call locally, before any I/O: a parameter, an amount or the configuration
 * broke a rule. This is an integration bug, never a gateway answer. Messages name the field,
 * never its value.
 *
 * @example
 * catch (error) {
 *   if (error instanceof PaylovInputError) logger.error('invalid paylov call', error.toJSON());
 *   throw error;
 * }
 */
export class PaylovInputError extends PaylovBaseError {
  override readonly name = 'PaylovInputError' as const;
  readonly kind = 'input' as const;
  readonly code: PaylovInputErrorCode;
  /**
   * SDK parameter path such as `items[0].priceTiyin`; `undefined` when the params or
   * configuration object itself, or a choice between its top-level keys, broke the rule.
   */
  readonly field: string | undefined;
  readonly rule: PaylovInputRule;

  constructor(init: PaylovInputErrorInit) {
    super(init.message);
    this.code = init.code;
    this.field = init.field;
    this.rule = init.rule;
  }

  protected diagnosticDetails(): DiagnosticDetails {
    return { field: this.field, rule: this.rule };
  }
}

/**
 * The client was closed with `close()`. Nothing was sent, or the gateway rejected the request
 * before running it; a new client, on this process or another, can make the call.
 *
 * @example
 * catch (error) {
 *   if (error instanceof PaylovClientClosedError) return serviceUnavailable();
 *   throw error;
 * }
 */
export class PaylovClientClosedError extends PaylovBaseError {
  override readonly name = 'PaylovClientClosedError' as const;
  readonly kind = 'closed' as const;
  readonly code = 'sdk_client_closed' as const;

  constructor() {
    super('PaylovClient is closed; create a new client');
  }

  protected diagnosticDetails(): DiagnosticDetails {
    return {};
  }
}

interface PaylovApiErrorInit {
  readonly code: PaylovErrorCode;
  readonly httpStatus: number;
  readonly endpoint: string;
  readonly fields?: readonly string[] | undefined;
  readonly retryAfterSeconds?: number | undefined;
  /**
   * A generic failure code from a call that can move money. Default `false`; HTTP 500 and above
   * always count.
   */
  readonly isUnsettled?: boolean;
}

/**
 * The gateway answered with an error code. Unknown codes keep this class; narrow with
 * {@link isPaylovApiError}.
 *
 * @example
 * catch (error) {
 *   if (isPaylovApiError(error, 'rate_limit_exceeded')) await wait(error.retryAfterSeconds ?? 60);
 *   else throw error;
 * }
 */
export class PaylovApiError extends PaylovBaseError {
  override readonly name = 'PaylovApiError' as const;
  readonly kind = 'api' as const;
  readonly code: PaylovErrorCode;
  readonly httpStatus: number;
  /** Static endpoint identity, e.g. `"POST /merchant/receipts/pay/"`. */
  readonly endpoint: string;
  /**
   * Wire field paths such as `items.0.title`, for `validation_error`, `field_not_valid` and
   * `field_required` only. Names, never messages or values; not translated to SDK names.
   */
  readonly fields: readonly string[] | undefined;
  /**
   * Seconds until a retry can succeed, from 1 to 3600: for `rate_limit_exceeded`, from the
   * `Retry-After` header (nothing retries a 429); for `card_is_blocked`,
   * the rest of the card's block after repeated wrong one-time codes.
   */
  readonly retryAfterSeconds: number | undefined;
  /** Whether the answer leaves the call's effect unknown; see {@link isPaylovOutcomeUnknown}. */
  readonly isUnsettled: boolean;

  constructor(init: PaylovApiErrorInit) {
    super(`Paylov returned ${init.code} (HTTP ${init.httpStatus}) for ${init.endpoint}`);
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.endpoint = init.endpoint;
    this.fields = init.fields;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.isUnsettled = init.httpStatus >= 500 || init.isUnsettled === true;
  }

  protected diagnosticDetails(): DiagnosticDetails {
    return {
      httpStatus: this.httpStatus,
      endpoint: this.endpoint,
      fields: this.fields,
      retryAfterSeconds: this.retryAfterSeconds,
      isUnsettled: this.isUnsettled,
    };
  }
}

interface PaylovProtocolErrorInit {
  readonly code: PaylovProtocolErrorCode;
  readonly httpStatus: number;
  readonly endpoint: string;
  readonly path?: string | undefined;
}

/**
 * The response did not match the endpoint's declared contract. After a POST the operation may
 * have executed: reconcile through the method's documented status read.
 *
 * @example
 * catch (error) {
 *   if (error instanceof PaylovProtocolError) metrics.increment('paylov.protocol', error.toJSON());
 *   throw error;
 * }
 */
export class PaylovProtocolError extends PaylovBaseError {
  override readonly name = 'PaylovProtocolError' as const;
  readonly kind = 'protocol' as const;
  readonly code: PaylovProtocolErrorCode;
  readonly httpStatus: number;
  readonly endpoint: string;
  /** The decoded location that failed, e.g. `result.card.status`; never its value. */
  readonly path: string | undefined;

  constructor(init: PaylovProtocolErrorInit) {
    super(
      init.code === 'sdk_malformed_response'
        ? `Paylov response for ${init.endpoint} has an unexpected shape` +
            (init.path !== undefined ? ` at "${init.path}"` : '')
        : `Paylov returned HTTP ${init.httpStatus} for ${init.endpoint} without a usable error body`,
    );
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.endpoint = init.endpoint;
    this.path = init.path;
  }

  protected diagnosticDetails(): DiagnosticDetails {
    return { httpStatus: this.httpStatus, endpoint: this.endpoint, path: this.path };
  }
}

interface PaylovConnectionErrorInit {
  readonly code: PaylovConnectionErrorCode;
  readonly endpoint: string;
  readonly isSent: boolean;
  readonly timeoutMs?: number | undefined;
}

const CONNECTION_MESSAGES: Readonly<Record<PaylovConnectionErrorCode, string>> = {
  sdk_timeout: 'Paylov request timed out',
  sdk_network_error: 'Paylov request failed before the response was fully received',
  sdk_aborted: 'Paylov request was aborted by the caller',
};

/**
 * No usable response: DNS, TCP or TLS failure, a reset, the SDK timeout, or the caller's abort.
 * The underlying error is discarded: an injected transport can embed URLs, headers, bodies and
 * credentials anywhere in it. Once `isSent`, the operation of a POST may have executed.
 *
 * @example
 * catch (error) {
 *   if (error instanceof PaylovConnectionError && error.code === 'sdk_timeout') {
 *     metrics.increment('paylov.timeout', { endpoint: error.endpoint });
 *   }
 *   throw error;
 * }
 */
export class PaylovConnectionError extends PaylovBaseError {
  override readonly name = 'PaylovConnectionError' as const;
  readonly kind = 'connection' as const;
  readonly code: PaylovConnectionErrorCode;
  readonly endpoint: string;
  /**
   * Whether an attempt of the call reached the transport. `false` only for an `sdk_aborted` that
   * fired before anything was sent, so nothing can have executed.
   */
  readonly isSent: boolean;
  /** For `sdk_timeout` only: the per-attempt deadline that expired. */
  readonly timeoutMs: number | undefined;

  constructor(init: PaylovConnectionErrorInit) {
    const message = init.isSent
      ? CONNECTION_MESSAGES[init.code]
      : `${CONNECTION_MESSAGES[init.code]} before it was sent`;
    super(init.timeoutMs !== undefined ? `${message} after ${init.timeoutMs} ms` : message);
    this.code = init.code;
    this.endpoint = init.endpoint;
    this.isSent = init.isSent;
    this.timeoutMs = init.timeoutMs;
  }

  protected diagnosticDetails(): DiagnosticDetails {
    return { endpoint: this.endpoint, isSent: this.isSent, timeoutMs: this.timeoutMs };
  }
}

/**
 * Anything this SDK throws. Narrow with {@link isPaylovError}, check
 * {@link isPaylovOutcomeUnknown} (a gateway 5xx counts too), then switch on `kind` and `code`.
 *
 * @example
 * catch (error) {
 *   if (!isPaylovError(error)) throw error;
 *   if (isPaylovOutcomeUnknown(error)) return reconcileLater();
 *   switch (error.kind) {
 *     case 'closed':
 *       return serviceUnavailable();
 *     case 'api':
 *       if (error.code === 'insufficient_funds') return declined();
 *       break;
 *   }
 *   throw error;
 * }
 */
export type PaylovError =
  | PaylovInputError
  | PaylovClientClosedError
  | PaylovApiError
  | PaylovProtocolError
  | PaylovConnectionError;

/** `sdk_invalid_input` for a method parameter. */
export function invalidInput(
  message: string,
  field: string,
  rule: PaylovInputRule,
): PaylovInputError {
  return new PaylovInputError({ code: 'sdk_invalid_input', message, field, rule });
}

/** `sdk_invalid_amount` for an amount parameter. */
export function invalidAmount(
  message: string,
  field: string,
  rule: PaylovInputRule,
): PaylovInputError {
  return new PaylovInputError({ code: 'sdk_invalid_amount', message, field, rule });
}

/** `sdk_config_error` for constructor configuration. */
export function configError(
  message: string,
  field: string,
  rule: PaylovInputRule,
): PaylovInputError {
  return new PaylovInputError({ code: 'sdk_config_error', message, field, rule });
}

export function clientClosedError(): PaylovClientClosedError {
  return new PaylovClientClosedError();
}

/** `sdk_malformed_response` for a 2xx body that does not match its documented shape. */
export function malformedResponse(context: ResponseContext, path?: string): PaylovProtocolError {
  return new PaylovProtocolError({ code: 'sdk_malformed_response', ...context, path });
}

/** `sdk_unexpected_status` for a non-2xx without a usable error body. */
export function unexpectedStatus(context: ResponseContext): PaylovProtocolError {
  return new PaylovProtocolError({ code: 'sdk_unexpected_status', ...context });
}

/** `sdk_aborted` for the caller's abort; `isSent` once an attempt of the call reached fetch. */
export function abortedError(endpoint: string, isSent: boolean): PaylovConnectionError {
  return new PaylovConnectionError({ code: 'sdk_aborted', endpoint, isSent });
}

/**
 * True for anything this SDK throws; narrows to the {@link PaylovError} union.
 *
 * @example
 * catch (error) {
 *   if (!isPaylovError(error)) throw error;
 *   metrics.increment('paylov.failure', { kind: error.kind, code: error.code });
 * }
 */
export function isPaylovError(error: unknown): error is PaylovError {
  return error instanceof PaylovBaseError;
}

/**
 * Generic failure codes that name no reason, so a money-moving endpoint answering one may still
 * have acted, unless the endpoint lists the code in `definitiveCodes`.
 */
export const UNSETTLED_FAILURE_CODES: ReadonlySet<string> = new Set([
  'processing_error',
  'unknown_error',
  'error_at_pay',
]);

/**
 * True when the operation may have executed although the call failed: a protocol error, a
 * connection error once a request was sent, or a gateway error with `isUnsettled`. That is HTTP
 * status 500 or above, or a generic failure code (`processing_error`, `unknown_error`,
 * `error_at_pay`) from a method that can charge, reserve, capture, release, refund or split funds.
 * The SDK assumes `processing_error` from `payments.pay` is a definitive decline. Reconcile such a
 * call through the method's documented status read before repeating it. False for input and
 * closed-client errors, an abort before anything was sent, other gateway errors (specific declines
 * such as `insufficient_funds` included), and anything the SDK did not throw.
 *
 * @example
 * catch (error) {
 *   if (isPaylovOutcomeUnknown(error)) return queueReconciliation(transactionId);
 *   throw error;
 * }
 */
export function isPaylovOutcomeUnknown(error: unknown): boolean {
  if (!isPaylovError(error)) return false;
  if (error.kind === 'api') return error.isUnsettled;
  if (error.kind === 'connection') return error.isSent;
  return error.kind === 'protocol';
}

/**
 * True for a gateway error code; with codes, only for one of those codes.
 *
 * @example
 * catch (error) {
 *   if (isPaylovApiError(error, 'transaction_already_payed')) return markPaid(transactionId);
 *   throw error;
 * }
 */
export function isPaylovApiError(error: unknown): error is PaylovApiError;
export function isPaylovApiError<C extends PaylovKnownErrorCode>(
  error: unknown,
  ...codes: [C, ...C[]]
): error is PaylovApiError & { readonly code: C };
export function isPaylovApiError(error: unknown, ...codes: readonly string[]): boolean {
  return error instanceof PaylovApiError && (codes.length === 0 || codes.includes(error.code));
}
