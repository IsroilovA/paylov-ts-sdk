import type { PaylovTransportConfig } from '../core/types.js';

/** Configuration for `PaylovOnboarding`. It needs no credentials. */
export interface PaylovOnboardingConfig extends PaylovTransportConfig {
  /** Gateway origin with no path, e.g. `https://dev.gw.paylov.uz`. */
  readonly baseUrl: string;
}

/** Parameters of `PaylovOnboarding.checkToken`. */
export interface CheckOnboardingTokenParams {
  /**
   * The single-use onboarding token Paylov issued. Paylov answers `validation_error` for one
   * shorter than 8 characters. Secret.
   */
  readonly token: string;
}

/** Parameters of `PaylovOnboarding.complete`. */
export interface CompleteOnboardingParams {
  /** The single-use onboarding token Paylov issued. Secret. */
  readonly token: string;
  /** The merchant API username to create. */
  readonly username: string;
  /**
   * The merchant API password to set. Secret. Paylov requires a lowercase and an uppercase
   * letter, a digit and a special character, and answers `validation_error` when the token,
   * username or password is shorter than 8 characters.
   */
  readonly password: string;
}

/** The API credentials onboarding issues. Store all of them in a secret manager at once. */
export interface OnboardingCompleted {
  readonly consumerKey: string;
  /** Secret, and shown only once: Paylov cannot return it again. */
  readonly consumerSecret: string;
  readonly username: string;
}
