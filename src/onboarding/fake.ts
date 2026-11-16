import { MISS, type FakeRequest, type PaylovFakeSurface, type Scripter } from '../core/fake.js';
import { ENDPOINTS, type PaylovOnboarding } from './client.js';
import type {
  CheckOnboardingTokenParams,
  CompleteOnboardingParams,
  OnboardingCompleted,
} from './types.js';

function encodeTokenUsable(isUsable: boolean): unknown {
  return isUsable ? { status: 'ok' } : MISS;
}

function encodeOnboardingCompleted(completed: OnboardingCompleted): unknown {
  return {
    consumer_key: completed.consumerKey,
    consumer_secret: completed.consumerSecret,
    username: completed.username,
  };
}

function decodeCheckTokenRequest({ query }: FakeRequest): CheckOnboardingTokenParams {
  return { token: query.string('token') };
}

/** The password is a credential, so it is never read back. */
function decodeCompleteRequest({
  query,
  body,
}: FakeRequest): Omit<CompleteOnboardingParams, 'password'> {
  return { token: query.string('token'), username: body.string('username') };
}

export function createOnboardingFake(
  script: Scripter<'onboarding', PaylovOnboarding>,
): PaylovFakeSurface<PaylovOnboarding> {
  return {
    checkToken: script(
      'onboarding.checkToken',
      ENDPOINTS.checkToken,
      encodeTokenUsable,
      decodeCheckTokenRequest,
    ),
    complete: script(
      'onboarding.complete',
      ENDPOINTS.complete,
      encodeOnboardingCompleted,
      decodeCompleteRequest,
    ),
  };
}
