# Onboarding

A one-time operator step, run from a trusted machine, that turns Paylov's single-use onboarding
token into the credentials `PaylovClient` needs.

```ts
import { PaylovOnboarding } from '@isroilov_an/paylov';

const onboarding = new PaylovOnboarding({ baseUrl: 'https://gateway.example' });

if (!(await onboarding.checkToken({ token: onboardingToken }))) {
  throw new Error('onboarding token is unusable; ask Paylov for a new one');
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
- Then ask Paylov to activate the account. Until it does, every authenticated `PaylovClient` call
  fails with `invalid_grant`, the same code as wrong credentials; `gateway.getStatus` needs no
  credentials and still answers.
- After an ambiguous failure of `complete`, call `checkToken`: `true` means `complete` can run
  again. `false` means only that the token is unusable: Paylov answers the same for a used, expired
  or unknown token, so whether credentials were issued stays unresolved. Ask Paylov to confirm or
  reissue them.
