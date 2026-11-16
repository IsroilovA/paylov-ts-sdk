import { readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { envelopeErrorCode, normalizeResponse } from '../../src/core/envelope.js';
import { PaylovApiError, PaylovProtocolError } from '../../src/core/errors.js';
import type { ResponseShape } from '../../src/core/types.js';
import {
  capture,
  expectApiError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import { loadFixture, loadWire } from '../helpers/fixtures.js';

const ENDPOINT = 'GET /merchant/payments/status/';
const SECRET = 'EXAMPLE-GATEWAY-MESSAGE-NOT-A-REAL-VALUE';

function normalize(
  body: unknown,
  httpStatus = 200,
  shape: ResponseShape = 'envelope',
  retryAfter: string | null = null,
): unknown {
  return normalizeResponse(body, { endpoint: ENDPOINT, httpStatus }, shape, retryAfter);
}

describe('success shapes', () => {
  it('envelope unwraps a non-null result, primitives included', async () => {
    const body = loadFixture('envelope/generic.success.synthesized.json');
    expect(normalize(body)).toEqual({ transactionId: '9b370dde-dfe1-4365-be8a-d3581c9479ba' });
    expect(normalize({ result: true })).toBe(true);
    await expectMalformed(() => normalize({ result: null, error: null }), 'result');
    await expectMalformed(
      () => normalize(loadFixture('envelope/generic.malformed.synthesized.json')),
      'result',
    );
  });

  it('flat returns the record itself', async () => {
    const { body } = loadWire('auth/revoke.success.wire.json');
    expect(normalize(body, 200, 'flat')).toEqual({ status: 'success' });
    await expectMalformed(() => normalize([], 200, 'flat'), undefined);
  });

  it('array requires a top-level array', async () => {
    expect(normalize([{ id: 1 }], 200, 'array')).toEqual([{ id: 1 }]);
    await expectMalformed(() => normalize({ result: [] }, 200, 'array'), undefined);
  });

  it('rejects non-objects for every decoded shape', async () => {
    for (const shape of ['envelope', 'flat'] as const) {
      await expectMalformed(() => normalize('text', 200, shape), undefined);
    }
  });
});

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
// Every recorded REST failure.
const RECORDED_ERRORS = readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.wire.json'))
  .map((path) => path.split(sep).join('/'))
  .filter((path) => loadWire(path).status >= 400)
  .toSorted();

describe('gateway errors', () => {
  it.each(RECORDED_ERRORS)('%s throws its code with its status, without the message', (path) => {
    const { status, body } = loadWire(path);
    const wireError = recordOf(recordOf(body)['error']);

    // Details vary per fixture and are asserted by the errorDetails suite.
    const error = capture(() => normalize(body, status));

    expect(error).toBeInstanceOf(PaylovApiError);
    expect(error).toMatchObject({
      code: wireError['code'],
      httpStatus: status,
      endpoint: ENDPOINT,
    });
    const message = wireError['message'];
    if (typeof message === 'string' && message !== wireError['code']) {
      expectNoSecretLeak(error, [message]);
    }
  });

  it('adds the decoded details', async () => {
    await expectApiError(() => normalize(loadWire('envelope/bearer.expired.wire.json').body, 401), {
      code: 'permission_denied',
      httpStatus: 401,
    });
    const { status, body } = loadWire('cards/confirmPanBinding.cardBlocked.wire.json');
    const blocked = await expectApiError(() => normalize(body, status), {
      code: 'card_is_blocked',
    });
    expect(blocked.retryAfterSeconds).toBe(298);
  });

  it('throws an error even with a 2xx status and for every shape', async () => {
    const body = loadFixture('envelope/generic.error.synthesized.json');
    for (const shape of ['envelope', 'flat', 'array'] as const) {
      await expectApiError(() => normalize(body, 200, shape), {
        code: 'insufficient_funds',
        httpStatus: 200,
      });
    }
  });

  it('never carries the gateway message or data', async () => {
    const error = await expectApiError(
      () =>
        normalize(
          { result: null, error: { code: 'card_not_found', message: SECRET, data: { x: SECRET } } },
          404,
        ),
      { code: 'card_not_found', httpStatus: 404 },
    );
    expectNoSecretLeak(error, [SECRET]);
  });
});

describe('unusable bodies', () => {
  it('reports an error without a valid code as malformed on 2xx and unexpected otherwise', async () => {
    for (const error of [{ code: SECRET }, { code: 42 }, 'failed', { message: 'x' }]) {
      await expectMalformed(() => normalize({ result: null, error }, 200), undefined);
      const unexpected = capture(() => normalize({ result: null, error }, 502));
      expect(unexpected).toBeInstanceOf(PaylovProtocolError);
      expect(unexpected).toMatchObject({ code: 'sdk_unexpected_status', httpStatus: 502 });
      expectNoSecretLeak(unexpected, [SECRET]);
    }
  });

  it('reports a non-2xx body without an error as an unexpected status', () => {
    for (const body of [
      '<html>Bad Gateway</html>',
      null,
      { result: { id: 1 } },
      { result: null, error: null },
    ]) {
      const error = capture(() => normalize(body, 503));
      expect(error).toBeInstanceOf(PaylovProtocolError);
      expect(error).toMatchObject({ code: 'sdk_unexpected_status', httpStatus: 503 });
    }
  });
});

describe('envelopeErrorCode', () => {
  it('returns a validated code or undefined', () => {
    expect(envelopeErrorCode(loadWire('envelope/bearer.expired.wire.json').body)).toBe(
      'permission_denied',
    );
    expect(envelopeErrorCode({ error: { code: 'Permission Denied' } })).toBeUndefined();
    expect(envelopeErrorCode({ error: { code: `a${'b'.repeat(128)}` } })).toBeUndefined();
    expect(envelopeErrorCode({ error: null })).toBeUndefined();
    expect(envelopeErrorCode('x')).toBeUndefined();
  });
});
