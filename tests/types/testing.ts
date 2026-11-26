/** Compile-time contracts for the `@isroilov_an/paylov/testing` entry point. */

import type {
  Card,
  CaptureHoldParams,
  CreateHoldParams,
  HoldsResource,
  GetHoldParams,
  Hold,
  ListTransactionsParams,
  PaylovClient,
  PaylovClientConfig,
  PaylovOnboardingConfig,
  StartPanPaymentParams,
  TransactionReference,
  WebhookInput,
} from '../../src/index.js';
import {
  createWebhookRequest,
  PAYLOV_FAKE_OTP,
  PaylovFakeGateway,
  startGatewaySimulator,
  type PaylovFakePanCard,
  type PaylovSimulator,
  type PaylovSimulatorStore,
  type PaylovFakeCardOptions,
  type PaylovFakeMethod,
  type PaylovFakeSurface,
} from '../../src/testing.js';
import type { IsEqual } from './exact.js';

const fake = new PaylovFakeGateway();
const clientConfig: PaylovClientConfig = fake.clientConfig;
const onboardingConfig: PaylovOnboardingConfig = fake.onboardingConfig;
const holdScript: PaylovFakeMethod<Hold, GetHoldParams> = fake.holds.get;
const anyScript: PaylovFakeMethod<unknown, unknown> = fake.payments.confirmPanPayment;
// The holds script is nameable: `create` replies with what the gateway sends.
const holdsScripts: PaylovFakeSurface<HoldsResource, { readonly create: TransactionReference }> =
  fake.holds;
const holdCreateScript: PaylovFakeMethod<TransactionReference, CreateHoldParams> =
  fake.holds.create;
void [clientConfig, onboardingConfig, holdScript, anyScript, holdsScripts, holdCreateScript];

const captured: readonly CaptureHoldParams[] = fake.holds.capture.requests;
const amountTiyin: number | undefined = fake.holds.capture.requests[0]?.amountTiyin;
const listed: readonly ListTransactionsParams[] = fake.transactions.list.requests;
const statusRequests: readonly undefined[] = fake.gateway.getStatus.requests;
const panRequests: readonly StartPanPaymentParams[] = fake.payments.startPanPayment.requests;
const onboardedUsername: string | undefined = fake.onboarding.complete.requests[0]?.username;
void [captured, amountTiyin, listed, statusRequests, panRequests, onboardedUsername];

fake.payments.create.reply({ transactionId: '00000000-0000-4000-8000-000000000001' });
fake.cards.delete.reply();
fake.onboarding.checkToken.reply(false);
fake.payments.pay.fail('insufficient_funds', { httpStatus: 400 });
fake.payments.pay.fail('a_future_gateway_code');
fake.gateway.getStatus.disconnect();
fake.gateway.getStatus.hang();
fake.holds.get.fail('transaction_not_found', {}, { persist: true });
fake.holds.get.fail('server_error', { httpStatus: 500 }, { persist: true });
fake.holds.get.disconnect({ persist: true });
fake.holds.get.hang({ persist: false });

// @ts-expect-error a reply takes the method's own result type
fake.payments.create.reply({ transactionId: 1 });
// @ts-expect-error a non-nullable result has no `null` reply
fake.cards.get.reply(null);
// @ts-expect-error a miss is a scripted failure, not a `null` reply
fake.holds.get.reply(null);
// @ts-expect-error every namespace mirrors the client; there is no `close` script
void fake.payments.close;
// @ts-expect-error the client's `close` is not an I/O method script
void fake.close;
// @ts-expect-error `persist` is a boolean
fake.holds.get.hang({ persist: 'always' });
// @ts-expect-error a scripted failure has no reason
fake.payments.pay.fail('invalid_grant', { reason: 'account_locked' });
// @ts-expect-error recorded params are read-only
fake.holds.capture.requests[0] = { transactionId: 't', amountTiyin: 100 };
// @ts-expect-error each method records its own params type
const wrongParams: readonly CaptureHoldParams[] = fake.holds.release.requests;
// @ts-expect-error the fake keeps no request log beside each method's `requests`
void fake.calls;
// @ts-expect-error the fake never records a password
void fake.onboarding.complete.requests[0]?.password;
void wrongParams;

type ClientNamespace = {
  [K in keyof PaylovClient]: PaylovClient[K] extends object
    ? PaylovClient[K] extends (...args: never[]) => unknown
      ? never
      : K
    : never;
}[keyof PaylovClient];
/** The methods of a namespace that send one request; `transactions.iterate` pages through `list`. */
type RequestMethodOf<R> = {
  [K in keyof R]: R[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof R];
/** `true` only when `Fake` has every client namespace, each with exactly the client's methods. */
type MirrorsClient<Fake> = false extends {
  [K in ClientNamespace]: K extends keyof Fake
    ? IsEqual<RequestMethodOf<PaylovClient[K]>, keyof Fake[K]>
    : false;
}[ClientNamespace]
  ? false
  : true;

const fakeMirrorsClient: MirrorsClient<PaylovFakeGateway> = true;
// @ts-expect-error a client namespace registered without its fake
const missingNamespace: MirrorsClient<Omit<PaylovFakeGateway, 'holds'>> = true;
// @ts-expect-error a fake namespace missing one of the client's methods
const missingMethod: MirrorsClient<{
  [K in keyof PaylovFakeGateway]: K extends 'cards'
    ? Omit<PaylovFakeGateway['cards'], 'get'>
    : PaylovFakeGateway[K];
}> = true;
void [fakeMirrorsClient, missingNamespace, missingMethod];

// @ts-expect-error iterate is served by the transactions.list script
void fake.transactions.iterate;
// holds.create replies with what the gateway sends; the SDK adds the deadline itself.
type HoldCreateReply = Parameters<typeof fake.holds.create.reply>[0];
const replyHasNoDeadline: 'clientCaptureDeadline' extends keyof HoldCreateReply ? false : true =
  true;
void replyHasNoDeadline;
fake.holds.create.reply({ transactionId: 't' });

const simulatedFake = new PaylovFakeGateway({ simulate: true, now: () => new Date() });
// @ts-expect-error the simulation clock returns a Date
const numericClockFake = new PaylovFakeGateway({ now: () => 0 });
void [simulatedFake, numericClockFake];
const refundingFake = new PaylovFakeGateway({ simulate: true, refundWindowMinutes: 60 });
// @ts-expect-error the refund window is a number of minutes
const textWindowFake = new PaylovFakeGateway({ simulate: true, refundWindowMinutes: '1h' });
void [refundingFake, textWindowFake];
declare const card: Card;
const cardOptions: PaylovFakeCardOptions = { spendableTiyin: 10_000_000 };
refundingFake.addCard(card, cardOptions);
refundingFake.addCard(card);
// @ts-expect-error the spending allowance is integer tiyin, never a SUM string
refundingFake.addCard(card, { spendableTiyin: '100000' });
// @ts-expect-error the allowance is not the reported balance
refundingFake.addCard(card, { balanceTiyin: 100_000 });
fake.token.fail('invalid_grant', { grant: 'refresh_token' });
fake.token.fail('rate_limit_exceeded', { retryAfterSeconds: 48 }, { persist: true });
// @ts-expect-error grants are the two the SDK sends
fake.token.fail('invalid_grant', { grant: 'client_credentials' });
const grants: readonly ('password' | 'refresh_token')[] = fake.token.requests;
void grants;

const panCard: PaylovFakePanCard = {
  cardNumber: 'PAN-FROM-SECURE-INPUT',
  cardExpiry: '9912',
  otp: PAYLOV_FAKE_OTP,
  details: { vendor: 'Humo', bankName: null },
};
refundingFake.addPanCard(panCard);
// @ts-expect-error a PAN card's spending allowance is integer tiyin
refundingFake.addPanCard({ ...panCard, spendableTiyin: '100000' });
// @ts-expect-error the card id comes from the binding, never from the PAN card
refundingFake.addPanCard({ ...panCard, details: { cardId: 'c' } });
const delayingFake = new PaylovFakeGateway({ simulate: true, refundReceiptDelaySeconds: 15 });
void delayingFake;

const store: PaylovSimulatorStore = {
  load: () => Promise.resolve(undefined),
  save: () => Promise.resolve(),
};
const simulator: Promise<PaylovSimulator> = startGatewaySimulator({
  port: 4010,
  store,
  panCards: [panCard],
  onProblem: (problem: string) => void problem,
});
// @ts-expect-error the certificate and key are PEM text
void startGatewaySimulator({ tls: { cert: 1, key: 'KEY' } });
declare const running: PaylovSimulator;
// @ts-expect-error a simulator has no scripts; script calls on PaylovFakeGateway
void running.payments;
const simulatorUrl: Promise<string> = simulator.then(({ url }) => url);
void simulatorUrl;

const request: WebhookInput = createWebhookRequest(
  {
    kind: 'transaction.cancel',
    transactionId: 't',
    account: {},
    amountTiyin: 100,
    cancelledAt: new Date(0),
  },
  { login: 'EXAMPLE-LOGIN', password: 'EXAMPLE-PASSWORD' },
);
void request;
