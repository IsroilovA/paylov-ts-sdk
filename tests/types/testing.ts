/** Compile-time contracts for the `@isroilov_an/paylov/testing` entry point. */

import type {
  CaptureHoldParams,
  GetHoldParams,
  Hold,
  ListTransactionsParams,
  PaylovClient,
  PaylovClientConfig,
  PaylovOnboardingConfig,
  StartPanPaymentParams,
  WebhookInput,
} from '../../src/index.js';
import {
  createWebhookRequest,
  PaylovFakeGateway,
  type PaylovFakeCall,
  type PaylovFakeMethod,
} from '../../src/testing.js';

const fake = new PaylovFakeGateway();
const clientConfig: PaylovClientConfig = fake.clientConfig;
const onboardingConfig: PaylovOnboardingConfig = fake.onboardingConfig;
const calls: readonly PaylovFakeCall[] = fake.calls;
const holdScript: PaylovFakeMethod<Hold | null, GetHoldParams> = fake.holds.get;
const anyScript: PaylovFakeMethod<unknown, unknown> = fake.payments.confirmPanPayment;
const calledMethod: PaylovFakeCall['method'] = 'payments.pay';
void [clientConfig, onboardingConfig, calls, holdScript, anyScript, calledMethod];

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
fake.holds.get.reply(null, { persist: true });
fake.holds.get.fail('server_error', { httpStatus: 500 }, { persist: true });
fake.holds.get.disconnect({ persist: true });
fake.holds.get.hang({ persist: false });

// @ts-expect-error a reply takes the method's own result type
fake.payments.create.reply({ transactionId: 1 });
// @ts-expect-error a non-nullable result has no `null` reply
fake.cards.get.reply(null);
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
// @ts-expect-error a call names a real SDK method
const misspelledMethod: PaylovFakeCall['method'] = 'payments.payy';
// @ts-expect-error the fake never records a password
void fake.onboarding.complete.requests[0]?.password;
void [wrongParams, misspelledMethod];

type IsEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type ClientNamespace = {
  [K in keyof PaylovClient]: PaylovClient[K] extends object
    ? PaylovClient[K] extends (...args: never[]) => unknown
      ? never
      : K
    : never;
}[keyof PaylovClient];
/** `true` only when `Fake` has every client namespace, each with exactly the client's methods. */
type MirrorsClient<Fake> = false extends {
  [K in ClientNamespace]: K extends keyof Fake
    ? IsEqual<keyof PaylovClient[K], keyof Fake[K]>
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

const request: WebhookInput = createWebhookRequest(
  { kind: 'card.bind', token: 't', userId: 'u', status: 'confirmed', cardId: 'c' },
  { login: 'EXAMPLE-LOGIN', password: 'EXAMPLE-PASSWORD' },
);
void request;
