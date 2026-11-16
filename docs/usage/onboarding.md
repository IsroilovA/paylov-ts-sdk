# Onboarding

A one-time operator step, run from a trusted machine, that turns Paylov's single-use onboarding
token into the credentials `PaylovClient` needs.

```ts
import { PaylovOnboarding } from '@isroilov_an/paylov';

const onboarding = new PaylovOnboarding({ baseUrl: 'https://gateway.example' });

if (!(await onboarding.checkToken({ token: onboardingToken }))) {
  throw new Error('onboarding token is consumed or expired; ask Paylov for a new one');
}

const credentials = await onboarding.complete({
  token: onboardingToken,
  username: merchantUsername,
  password: merchantPassword,
});
await secretManager.store('paylov', { ...credentials, password: merchantPassword });
```

- `consumerSecret` is shown once and the token works once: persist the result, with the password,
  before anything else.
- Then ask Paylov to activate the account. Until it does, every `PaylovClient` call fails with
  `invalid_grant`, the same code as wrong credentials.
- After an ambiguous failure of `complete`, call `checkToken`: `true` means `complete` can run
  again; `false` means the token was used, so ask Paylov to reissue the credentials.
