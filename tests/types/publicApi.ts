/** Compile-time contracts for the package root: client, standalone surfaces, errors and money. */

import {
  formatSum,
  isPaylovApiError,
  isPaylovError,
  isPaylovOutcomeUnknown,
  PaylovApiError,
  PaylovClient,
  PaylovClientClosedError,
  PaylovConnectionError,
  PaylovInputError,
  PaylovOnboarding,
  PaylovProtocolError,
  sumToTiyin,
  type CardsResource,
  type FiscalizationResource,
  type FiscalReceiptItem,
  type GatewayResource,
  type HoldsResource,
  type PaylovCallOptions,
  type PaylovClientConfig,
  type PaylovError,
  type PaylovErrorCode,
  type PaylovErrorDiagnostic,
  type PaylovErrorKind,
  type PaylovHttpMethod,
  type PaylovInputErrorCode,
  type PaylovInputRule,
  type PaylovJsonObject,
  type PaylovKnownErrorCode,
  type PaylovLogger,
  type PaylovLoggerRequestEvent,
  type PaylovLoggerResponseEvent,
  type PaylovTransportConfig,
  type PaymentsResource,
  type SplitsResource,
  type SubMerchantsResource,
  type TransactionLookup,
  type TransactionReference,
  type TransactionsResource,
} from '../../src/index.js';

declare const paylovConsumerKey: string;
declare const paylovConsumerSecret: string;
declare const paylovUsername: string;
declare const paylovPassword: string;

const config = {
  baseUrl: 'https://gateway.example',
  consumerKey: paylovConsumerKey,
  consumerSecret: paylovConsumerSecret,
  username: paylovUsername,
  password: paylovPassword,
  timeoutMs: 10_000,
} satisfies PaylovClientConfig;

// Client and namespaces
const client = new PaylovClient(config);
const namespaces: {
  gateway: GatewayResource;
  cards: CardsResource;
  payments: PaymentsResource;
  transactions: TransactionsResource;
  holds: HoldsResource;
  splits: SplitsResource;
  fiscalization: FiscalizationResource;
  subMerchants: SubMerchantsResource;
} = client;
void namespaces;
// @ts-expect-error namespaces are fixed at construction
client.cards = namespaces.cards;
const options: PaylovCallOptions = { signal: AbortSignal.timeout(5_000) };
const closed: Promise<void> = client.close(options);
void closed;
// @ts-expect-error required credentials cannot be omitted
void new PaylovClient({ baseUrl: 'https://gateway.example' });
// @ts-expect-error retries are not configurable
void new PaylovClient({ ...config, maxRetries: 3 });
// @ts-expect-error call options carry only an AbortSignal
void client.close({ signal: 'soon' });

const transport: PaylovTransportConfig = config;
void transport;

// Standalone surfaces
void new PaylovOnboarding({ baseUrl: 'https://dev.gw.paylov.uz' });
// @ts-expect-error the credential-free surfaces take no merchant credentials
void new PaylovOnboarding({ baseUrl: 'https://dev.gw.paylov.uz', password: paylovPassword });

// Shared public types
const account: PaylovJsonObject = { order_id: 'A-1001', lines: [1, 2], meta: { gift: true } };
void account;
// @ts-expect-error JSON objects hold JSON values only
const nonJson: PaylovJsonObject = { at: new Date() };
void nonJson;
const tinItem: FiscalReceiptItem = {
  title: 'item',
  priceTiyin: 100,
  count: 1,
  code: 'code',
  vatPercent: 12,
  packageCode: 'package',
  tin: '123456789',
};
const discounted: FiscalReceiptItem = { ...tinItem, discountTiyin: 50 };
void discounted;
// @ts-expect-error a discount is a tiyin number
const textDiscount: FiscalReceiptItem = { ...tinItem, discountTiyin: '50' };
void textDiscount;
// @ts-expect-error an item carries tin XOR pinfl, never both
const itemWithBoth: FiscalReceiptItem = { ...tinItem, pinfl: '12345678901234' };
void itemWithBoth;

declare const transactionId: string;
const reference: TransactionReference = { transactionId };
const byId: TransactionLookup = { transactionId };
const byExternalId: TransactionLookup = { externalId: 'booking-1', transactionId: undefined };
void [reference, byId, byExternalId];
// @ts-expect-error a lookup carries exactly one of transactionId or externalId
const byBoth: TransactionLookup = { transactionId, externalId: 'booking-1' };
void byBoth;

// Logger events
const logger: PaylovLogger = {
  onRequest: (event: PaylovLoggerRequestEvent) => {
    void [event.method, event.endpoint, event.attempt];
  },
  onResponse: (event: PaylovLoggerResponseEvent) => Promise.resolve(void event.httpStatus),
};
void logger;
declare const requestEvent: PaylovLoggerRequestEvent;
// @ts-expect-error logger events are metadata only
void requestEvent.body;
// @ts-expect-error logger events do not expose headers
void requestEvent.headers;
const loggedMethod: PaylovHttpMethod = requestEvent.method;
void loggedMethod;
declare const responseEvent: PaylovLoggerResponseEvent;
// Logged codes autocomplete like error codes; unknown gateway codes still type.
const loggedCode: PaylovErrorCode | undefined = responseEvent.errorCode;
void loggedCode;
// @ts-expect-error the gateway uses no other HTTP method
const patch: PaylovHttpMethod = 'PATCH';
void patch;

// Errors and guards
declare const caught: unknown;
if (isPaylovError(caught)) {
  const kind: PaylovErrorKind = caught.kind;
  const diagnostic: PaylovErrorDiagnostic = caught.toJSON();
  void [kind, diagnostic];
  switch (caught.kind) {
    case 'input': {
      const rule: PaylovInputRule = caught.rule;
      const field: string | undefined = caught.field;
      void [rule, field, caught.name satisfies 'PaylovInputError'];
      break;
    }
    case 'closed':
      void [
        caught.code satisfies 'sdk_client_closed',
        caught.name satisfies 'PaylovClientClosedError',
      ];
      break;
    case 'api':
      void [caught.httpStatus, caught.fields, caught.retryAfterSeconds];
      break;
    case 'protocol':
      void [caught.httpStatus, caught.path];
      break;
    case 'connection': {
      const code: 'sdk_timeout' | 'sdk_network_error' | 'sdk_aborted' = caught.code;
      const isSent: boolean = caught.isSent;
      void [code, isSent, caught.timeoutMs];
      break;
    }
    default: {
      const exhaustive: never = caught;
      void exhaustive;
    }
  }
  // @ts-expect-error only API errors carry gateway field paths
  void caught.fields;
}
const outcomeUnknown: boolean = isPaylovOutcomeUnknown(caught);
void outcomeUnknown;
if (isPaylovApiError(caught)) {
  const code: PaylovErrorCode = caught.code;
  const fields: readonly string[] | undefined = caught.fields;
  const retryAfterSeconds: number | undefined = caught.retryAfterSeconds;
  void [code, fields, retryAfterSeconds, caught.httpStatus, caught.endpoint];
  // @ts-expect-error the SDK derives no sub-reason from gateway messages or statuses
  void caught.reason;
  // @ts-expect-error gateway diagnostic data is not a public channel
  void caught.data;
}
if (isPaylovApiError(caught, 'insufficient_funds', 'card_not_found')) {
  const code: 'insufficient_funds' | 'card_not_found' = caught.code;
  void code;
}
// @ts-expect-error the narrowing overload accepts known gateway codes only
void isPaylovApiError(caught, 'sdk_timeout');
// @ts-expect-error the narrowing overload accepts known gateway codes only
void isPaylovApiError(caught, 'some_future_code');
const knownCode: PaylovKnownErrorCode = 'permission_denied';
// An unknown gateway code still types: the code union stays open.
const futureCode: PaylovErrorCode = 'some_future_code';
void [knownCode, futureCode];
// @ts-expect-error a closed client is its own kind, not an input error
const closedAsInput: PaylovInputErrorCode = 'sdk_client_closed';
void closedAsInput;
const errorClasses: (new (...args: never[]) => PaylovError)[] = [
  PaylovInputError,
  PaylovClientClosedError,
  PaylovApiError,
  PaylovProtocolError,
  PaylovConnectionError,
];
void errorClasses;

// Money
const tiyin: number = sumToTiyin('12.50');
const display: string = formatSum(tiyin);
void display;
// @ts-expect-error formatSum takes integer tiyin, not a decimal string
void formatSum('12.50');
