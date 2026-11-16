/** Compile-time contracts for `PaylovOnboarding`. */

import {
  PaylovOnboarding,
  type CheckOnboardingTokenParams,
  type CompleteOnboardingParams,
  type OnboardingCompleted,
} from '../../src/index.js';

declare const onboardingToken: string;
declare const merchantUsername: string;
declare const merchantPassword: string;

const onboarding = new PaylovOnboarding({ baseUrl: 'https://dev.gw.paylov.uz', timeoutMs: 10_000 });

const checkParams: CheckOnboardingTokenParams = { token: onboardingToken };
const usable: boolean = await onboarding.checkToken(checkParams, {
  signal: AbortSignal.timeout(5_000),
});
void usable;

const completeParams: CompleteOnboardingParams = {
  token: onboardingToken,
  username: merchantUsername,
  password: merchantPassword,
};
const credentials: OnboardingCompleted = await onboarding.complete(completeParams);
const { consumerKey, consumerSecret, username } = credentials;
void [consumerKey, consumerSecret, username];

// @ts-expect-error complete needs the token, the username and the password
void onboarding.complete({ token: onboardingToken, username: merchantUsername });
// @ts-expect-error checkToken takes an object, not the bare token
void onboarding.checkToken(onboardingToken);
// @ts-expect-error the issued credentials are read-only
credentials.consumerSecret = 'EXAMPLE-CONSUMER-SECRET-NOT-A-REAL-CREDENTIAL';
