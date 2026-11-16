import { asLiteral, asString, fieldOf, readFields, type Decoder } from '../core/decoding.js';
import type { OnboardingCompleted } from './types.js';

/** `{"status":"ok"}` means the token is usable. */
export const decodeTokenUsable: Decoder<true> = (value, path) => {
  fieldOf('status', asLiteral('ok'))(value, path);
  return true;
};

/** Failures name the field, never its value: the same body holds the consumer secret. */
export const decodeOnboardingCompleted: Decoder<OnboardingCompleted> = (value, path) => {
  const field = readFields(value, path);
  return {
    consumerKey: field('consumer_key', asString),
    consumerSecret: field('consumer_secret', asString),
    username: field('username', asString),
  };
};
