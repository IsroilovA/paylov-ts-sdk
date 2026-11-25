/**
 * The only error classes this SDK throws, one per origin. Errors carry allowlisted metadata only:
 * never a request body, query value, header, gateway message, gateway `data` or raw cause,
 * because those hold passwords, card data and caller identifiers.
 */

import type { PaylovErrorCode, PaylovKnownErrorCode } from './errorCodes.js';
import type { EndpointEffect, ResponseContext } from './types.js';

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
  readonly isOutcomeUnknown?: boolean;
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
  /** Default `false`. */
  readonly isOutcomeUnknown?: boolean;
}

/**
 * The gateway answered with an error code, or with a success body that means a miss, reported
 * with the code the gateway uses for that miss. Unknown codes keep this class; narrow with
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
   * Seconds until a retry can succeed, from 1 to 3600: for `rate_limit_exceeded` and any other
   * HTTP 429, from the `Retry-After` header (nothing retries a 429); for `card_is_blocked`, the
   * rest of the card's block after repeated wrong one-time codes, unless a 429's header sets it.
   */
  readonly retryAfterSeconds: number | undefined;
  /**
   * Whether the requested operation may have executed although the call failed: HTTP 500 and
   * above from an operation that writes, or a generic failure code (`processing_error`,
   * `unknown_error`, `error_at_pay`) from one that moves money. Never for a read. Read it through
   * {@link isPaylovOutcomeUnknown}.
   */
  readonly isOutcomeUnknown: boolean;

  constructor(init: PaylovApiErrorInit) {
    super(`Paylov returned ${init.code} (HTTP ${init.httpStatus}) for ${init.endpoint}`);
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.endpoint = init.endpoint;
    this.fields = init.fields;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.isOutcomeUnknown = init.isOutcomeUnknown ?? false;
  }

  protected diagnosticDetails(): DiagnosticDetails {
    return {
      httpStatus: this.httpStatus,
      endpoint: this.endpoint,
      fields: this.fields,
      retryAfterSeconds: this.retryAfterSeconds,
      isOutcomeUnknown: this.isOutcomeUnknown,
    };
  }
}

interface PaylovProtocolErrorInit {
  readonly code: PaylovProtocolErrorCode;
  readonly httpStatus: number;
  readonly endpoint: string;
  readonly path?: string | undefined;
  readonly retryAfterSeconds?: number | undefined;
  /** Default `false`. */
  readonly isOutcomeUnknown?: boolean;
}

/**
 * The response did not match the endpoint's declared contract. When the requested operation
 * writes, it may have executed (`isOutcomeUnknown`): reconcile through the method's documented
 * status read.
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
  /**
   * For an HTTP 429 without a usable error body: seconds from 1 to 3600 from its `Retry-After`
   * header, which is read whatever the body holds. Nothing retries a 429.
   */
  readonly retryAfterSeconds: number | undefined;
  /**
   * Whether the requested operation may have executed: true when it writes, never for a read.
   * Read it through {@link isPaylovOutcomeUnknown}.
   */
  readonly isOutcomeUnknown: boolean;

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
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.isOutcomeUnknown = init.isOutcomeUnknown ?? false;
  }

  protected diagnosticDetails(): DiagnosticDetails {
    return {
      httpStatus: this.httpStatus,
      endpoint: this.endpoint,
      path: this.path,
      retryAfterSeconds: this.retryAfterSeconds,
      isOutcomeUnknown: this.isOutcomeUnknown,
    };
  }
}

interface PaylovConnectionErrorInit {
  readonly code: PaylovConnectionErrorCode;
  readonly endpoint: string;
  readonly isSent: boolean;
  readonly timeoutMs?: number | undefined;
  /** Default `false`. */
  readonly isOutcomeUnknown?: boolean;
}

const CONNECTION_MESSAGES: Readonly<Record<PaylovConnectionErrorCode, string>> = {
  sdk_timeout: 'Paylov request timed out',
  sdk_network_error: 'Paylov request failed before the response was fully received',
  sdk_aborted: 'Paylov request was aborted by the caller',
};

/**
 * No usable response: DNS, TCP or TLS failure, a reset, the SDK timeout, or the caller's abort.
 * The underlying error is discarded: an injected transport can embed URLs, headers, bodies and
 * credentials anywhere in it. Whether the requested operation may have executed is
 * `isOutcomeUnknown`.
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
  /**
   * Whether the requested operation may have executed: true when it writes and the failed
   * attempt reached the transport. False for a read, and when the failure stopped the operation
   * before any attempt that could execute it, even with `isSent` (a failed token grant, or an
   * abort after a rejected token). Read it through {@link isPaylovOutcomeUnknown}.
   */
  readonly isOutcomeUnknown: boolean;

  constructor(init: PaylovConnectionErrorInit) {
    const message = init.isSent
      ? CONNECTION_MESSAGES[init.code]
      : `${CONNECTION_MESSAGES[init.code]} before it was sent`;
    super(init.timeoutMs !== undefined ? `${message} after ${init.timeoutMs} ms` : message);
    this.code = init.code;
    this.endpoint = init.endpoint;
    this.isSent = init.isSent;
    this.timeoutMs = init.timeoutMs;
    this.isOutcomeUnknown = init.isOutcomeUnknown ?? false;
  }

  protected diagnosticDetails(): DiagnosticDetails {
    return {
      endpoint: this.endpoint,
      isSent: this.isSent,
      timeoutMs: this.timeoutMs,
      isOutcomeUnknown: this.isOutcomeUnknown,
    };
  }
}

/**
 * Anything this SDK throws. Narrow with {@link isPaylovError}, check
 * {@link isPaylovOutcomeUnknown}, then switch on `kind` and `code`.
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

/**
 * Generic failure codes that name no reason, so a money endpoint answering one may still have
 * acted.
 */
const GENERIC_FAILURE_CODES: ReadonlySet<string> = new Set([
  'processing_error',
  'unknown_error',
  'error_at_pay',
]);

function isUnknownGatewayOutcome(context: ResponseContext, code: string): boolean {
  if (context.effect === 'read') return false;
  return (
    context.httpStatus >= 500 || (context.effect === 'money' && GENERIC_FAILURE_CODES.has(code))
  );
}

/** A gateway error `code` from a response, with the error facts decoded beside the code. */
export function gatewayError(
  context: ResponseContext,
  code: string,
  details: Pick<PaylovApiErrorInit, 'fields' | 'retryAfterSeconds'>,
): PaylovApiError {
  return new PaylovApiError({
    code,
    endpoint: context.endpoint,
    httpStatus: context.httpStatus,
    ...details,
    isOutcomeUnknown: isUnknownGatewayOutcome(context, code),
  });
}

function protocolError(
  context: ResponseContext,
  details: Pick<PaylovProtocolErrorInit, 'code' | 'path' | 'retryAfterSeconds'>,
): PaylovProtocolError {
  return new PaylovProtocolError({
    endpoint: context.endpoint,
    httpStatus: context.httpStatus,
    ...details,
    isOutcomeUnknown: context.effect !== 'read',
  });
}

/** `sdk_malformed_response` for a 2xx body that does not match its documented shape. */
export function malformedResponse(context: ResponseContext, path?: string): PaylovProtocolError {
  return protocolError(context, { code: 'sdk_malformed_response', path });
}

/**
 * `sdk_unexpected_status` for a non-2xx without a usable error body, with the delay a 429's
 * `Retry-After` header asks for.
 */
export function unexpectedStatus(
  context: ResponseContext,
  retryAfterSeconds?: number,
): PaylovProtocolError {
  return protocolError(context, { code: 'sdk_unexpected_status', retryAfterSeconds });
}

/**
 * The gateway's not-found `code` for a success body that reports a miss without an error, such as
 * an empty lookup list. Definitive, never an unknown outcome.
 */
export function synthesizedMiss(
  context: ResponseContext,
  code: PaylovKnownErrorCode,
): PaylovApiError {
  return new PaylovApiError({
    code,
    endpoint: context.endpoint,
    httpStatus: context.httpStatus,
  });
}

/** A connection failure of an attempt that reached fetch. */
export function attemptFailure(
  code: PaylovConnectionErrorCode,
  endpoint: string,
  effect: EndpointEffect,
  timeoutMs?: number,
): PaylovConnectionError {
  return new PaylovConnectionError({
    code,
    endpoint,
    isSent: true,
    timeoutMs,
    isOutcomeUnknown: effect !== 'read',
  });
}

/**
 * `sdk_aborted` outside an attempt: before its fetch, or during a retry backoff. `isSent` once an
 * earlier attempt of the call reached fetch; that attempt was a rejected token or a retried read,
 * so the outcome stays known.
 */
export function abortedError(endpoint: string, isSent: boolean): PaylovConnectionError {
  return new PaylovConnectionError({ code: 'sdk_aborted', endpoint, isSent });
}

/**
 * `error` as one caller sees it when it stopped the call before the call's own operation reached
 * the gateway, such as a failed token grant: a new error with the same code, endpoint and
 * transport facts and a known outcome. A grant's error is shared by every waiter and by the
 * password latch and cool-down, so each caller gets its own copy, never the shared object.
 */
export function beforeOperation(error: unknown): unknown {
  if (error instanceof PaylovApiError) {
    const { code, httpStatus, endpoint, fields, retryAfterSeconds } = error;
    const copiedFields = fields === undefined ? undefined : [...fields];
    return new PaylovApiError({
      code,
      httpStatus,
      endpoint,
      fields: copiedFields,
      retryAfterSeconds,
    });
  }
  if (error instanceof PaylovProtocolError) {
    const { code, httpStatus, endpoint, path, retryAfterSeconds } = error;
    return new PaylovProtocolError({ code, httpStatus, endpoint, path, retryAfterSeconds });
  }
  if (error instanceof PaylovConnectionError) {
    const { code, endpoint, isSent, timeoutMs } = error;
    return new PaylovConnectionError({ code, endpoint, isSent, timeoutMs });
  }
  if (error instanceof PaylovClientClosedError) return clientClosedError();
  return error;
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
 * True when the requested operation may have executed although the call failed: the error's
 * `isOutcomeUnknown`. That holds for a protocol error, HTTP status 500 or above, or a connection
 * failure once a request was sent, from a method that writes (creates, confirms, registers,
 * deletes or moves something), and also for a generic failure code (`processing_error`,
 * `unknown_error`, `error_at_pay`) from a method that charges, reserves, captures, releases,
 * refunds or splits funds. Reconcile such a call through the method's documented status read
 * before repeating it. False for any failure of a read, input and closed-client errors, a failure
 * before the operation was sent (such as a failed token grant), other gateway errors (specific
 * declines such as `insufficient_funds` included), and any value that is not an SDK error instance.
 * It reads the flag of any SDK error instance, including one the caller constructed.
 *
 * @example
 * catch (error) {
 *   if (isPaylovOutcomeUnknown(error)) return queueReconciliation(transactionId);
 *   throw error;
 * }
 */
export function isPaylovOutcomeUnknown(error: unknown): boolean {
  if (!isPaylovError(error)) return false;
  return error.kind !== 'input' && error.kind !== 'closed' && error.isOutcomeUnknown;
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
