import { FakeRefusal, type FakeRequest, type FakeSpecTable } from '../core/fake.js';
import { ENDPOINTS, type PaylovOnboarding } from './client.js';
import type {
  CheckOnboardingTokenParams,
  CompleteOnboardingParams,
  OnboardingCompleted,
} from './types.js';

/** An unusable token is Paylov's `invalid_or_expired` error. */
function encodeTokenUsable(isUsable: boolean): unknown {
  return isUsable ? { status: 'ok' } : new FakeRefusal('invalid_or_expired');
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

/** The password is a credential: its presence is checked, its value never kept. */
function decodeCompleteRequest({
  query,
  body,
}: FakeRequest): Omit<CompleteOnboardingParams, 'password'> {
  body.string('password');
  return { token: query.string('token'), username: body.string('username') };
}

export const ONBOARDING_FAKES: FakeSpecTable<PaylovOnboarding> = {
  checkToken: {
    endpoint: ENDPOINTS.checkToken,
    encode: encodeTokenUsable,
    decodeRequest: decodeCheckTokenRequest,
  },
  complete: {
    endpoint: ENDPOINTS.complete,
    encode: encodeOnboardingCompleted,
    decodeRequest: decodeCompleteRequest,
  },
};
