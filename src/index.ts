/** The package's only public entry point; every other module is internal. */

// Client
export { PaylovClient, type PaylovClientConfig } from './client.js';
export type { GatewayResource } from './gateway/resource.js';
export type { CardsResource } from './cards/resource.js';
export type { PaymentsResource } from './payments/resource.js';
export type { TransactionsResource } from './transactions/resource.js';
export type { HoldsResource } from './holds/resource.js';
export type { SplitsResource } from './splits/resource.js';
export type { FiscalizationResource } from './fiscalization/resource.js';
export type { SubMerchantsResource } from './subMerchants/resource.js';
export type * from './gateway/types.js';
export type * from './cards/types.js';
export type * from './payments/types.js';
export type * from './transactions/types.js';
export type * from './holds/types.js';
export type * from './splits/types.js';
export type * from './fiscalization/types.js';
export type * from './subMerchants/types.js';

// Standalone surfaces
export { createCheckoutUrl } from './checkout/link.js';
export type { CreateCheckoutUrlParams } from './checkout/link.js';
export { PaylovOnboarding } from './onboarding/client.js';
export type * from './onboarding/types.js';
export { PaylovWebhookReceiver } from './webhooks/receiver.js';
export { createWebhookResponse } from './webhooks/responses.js';
export type * from './webhooks/types.js';

// Shared public types
export type { CheckoutAmount, CheckoutCurrency } from './shared/checkoutAmount.js';
export type { FiscalReceiptItem, FiscalReceiptItemBase } from './shared/receiptItems.js';
export type { OtpSmsSettings } from './shared/otpSms.js';
export type { TransactionLookup, TransactionReference } from './shared/transactions.js';
export type {
  FetchLike,
  PaylovCallOptions,
  PaylovHttpMethod,
  PaylovJsonObject,
  PaylovJsonValue,
  PaylovLogger,
  PaylovLoggerRequestEvent,
  PaylovLoggerResponseEvent,
  PaylovTransportConfig,
} from './core/types.js';

// Errors
export {
  PaylovInputError,
  PaylovClientClosedError,
  PaylovApiError,
  PaylovProtocolError,
  PaylovConnectionError,
  isPaylovError,
  isPaylovApiError,
  isPaylovOutcomeUnknown,
} from './core/errors.js';
export type {
  PaylovError,
  PaylovConnectionErrorCode,
  PaylovErrorDiagnostic,
  PaylovErrorKind,
  PaylovInputErrorCode,
  PaylovInputRule,
  PaylovProtocolErrorCode,
} from './core/errors.js';
export type { PaylovErrorCode, PaylovKnownErrorCode } from './core/errorCodes.js';

// Money
export { formatSum, sumToTiyin } from './core/money.js';
