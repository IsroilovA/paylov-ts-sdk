import { describe, expect, it } from 'vitest';

import * as sdk from '../src/index.js';
import * as testing from '../src/testing.js';

/** The package-public value surface; an accidental export of internal wiring fails this test. */
const PUBLIC_EXPORTS = [
  'PaylovApiError',
  'PaylovClient',
  'PaylovClientClosedError',
  'PaylovConnectionError',
  'PaylovInputError',
  'PaylovOnboarding',
  'PaylovProtocolError',
  'PaylovWebhookReceiver',
  'formatSum',
  'isPaylovApiError',
  'isPaylovError',
  'isPaylovOutcomeUnknown',
  'readHoldState',
  'readRefundState',
  'sumToTiyin',
];

describe('package entry points', () => {
  it('exports exactly the supported public surface', () => {
    expect(Object.keys(sdk).toSorted()).toEqual(PUBLIC_EXPORTS);
  });

  it('exports exactly the supported testing surface', () => {
    expect(Object.keys(testing).toSorted()).toEqual([
      'PAYLOV_FAKE_OTP',
      'PaylovFakeGateway',
      'createWebhookRequest',
      'startGatewaySimulator',
    ]);
  });
});
