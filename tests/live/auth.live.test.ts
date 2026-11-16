/**
 * Sandbox gateway reads and the token lifecycle, observed through `config.logger` and
 * `config.fetch`: the anonymous liveness probe, the bank list, one login reused across calls,
 * the refresh grant, revocation on `close()`, and a refused grant.
 */

import { describe, expect, it } from 'vitest';

import {
  PaylovClientClosedError,
  type FetchLike,
  type PaylovLogger,
  type PaylovLoggerResponseEvent,
} from '../../src/index.js';
import { liveClient, liveGate, newLiveClient, observe, refused } from '../helpers/live.js';

const gate = await liveGate();

const TOKEN_ENDPOINT = 'POST /merchant/oauth2/token/';
const REVOKE_ENDPOINT = 'POST /merchant/oauth2/revoke/';

function responseRecorder(events: PaylovLoggerResponseEvent[]): PaylovLogger {
  return {
    onResponse: (event) => {
      events.push(event);
    },
  };
}

function grantType(body: RequestInit['body']): string {
  if (typeof body !== 'string') return 'unreadable';
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === 'object' && parsed !== null && 'grant_type' in parsed
    ? String(parsed.grant_type)
    : 'unreadable';
}

/**
 * Records each token request's `grant_type` (that field only) and shortens the first issued
 * access token to the 60 s refresh margin, so the next call must use the refresh grant. Token
 * bodies stay in memory.
 */
function shortFirstAccessToken(grants: string[]): FetchLike {
  let shortened = false;
  return async (input, init) => {
    const response = await fetch(input, init);
    if (!input.endsWith('/merchant/oauth2/token/')) return response;
    grants.push(grantType(init.body));
    if (shortened || !response.ok) return response;
    shortened = true;
    const body: unknown = JSON.parse(await response.text());
    const replaced = typeof body === 'object' && body !== null ? { ...body, expires_in: 60 } : body;
    return new Response(JSON.stringify(replaced), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe.skipIf(!gate.enabled)('gateway reads', () => {
  if (!gate.enabled) return;
  const client = liveClient(gate.config);

  it('getStatus resolves for the live gateway', async () => {
    await expect(client.gateway.getStatus()).resolves.toBeUndefined();
  });

  it('listBanks decodes string bank ids and names', async () => {
    const banks = await client.gateway.listBanks();
    observe('gateway.listBanks', {
      count: banks.length,
      withOfficialName: banks.filter((bank) => bank.officialName !== null).length,
    });
    expect(banks.length).toBeGreaterThan(0);
    for (const bank of banks) {
      expect(bank.bankId).toMatch(/^\d+$/);
      expect(typeof bank.name).toBe('string');
    }
  });
});

describe.skipIf(!gate.enabled)('token lifecycle', () => {
  if (!gate.enabled) return;
  const { config } = gate;

  it('logs in lazily once, reuses the token, revokes it on close, then refuses calls', async () => {
    const events: PaylovLoggerResponseEvent[] = [];
    const client = newLiveClient(config, { logger: responseRecorder(events) });
    const count = (endpoint: string): number =>
      events.filter((event) => event.endpoint === endpoint).length;

    await client.gateway.getStatus();
    expect(count(TOKEN_ENDPOINT), 'getStatus sends no token and triggers no login').toBe(0);

    await client.gateway.listBanks();
    await client.gateway.listBanks();
    expect(count(TOKEN_ENDPOINT), 'two reads share one login').toBe(1);

    await client.close();
    const revokes = events.filter((event) => event.endpoint === REVOKE_ENDPOINT);
    observe('auth.close', {
      revokes: revokes.length,
      revokeStatus: revokes[0]?.httpStatus ?? null,
    });
    expect(revokes.map((event) => event.httpStatus)).toEqual([200]);

    const afterClose: unknown = await client.gateway.listBanks().catch((error: unknown) => error);
    expect(afterClose).toBeInstanceOf(PaylovClientClosedError);
    expect(afterClose).toMatchObject({ kind: 'closed', code: 'sdk_client_closed' });
  });

  it('an expiring access token is replaced through the refresh grant', async () => {
    const grants: string[] = [];
    const client = newLiveClient(config, { fetch: shortFirstAccessToken(grants) });

    await client.gateway.listBanks();
    const banks = await client.gateway.listBanks();
    await client.close();

    observe('auth.grants', { sequence: grants.join(',') });
    expect(grants).toEqual(['password', 'refresh_token']);
    expect(banks.length).toBeGreaterThan(0);
  });

  it('a wrong consumer secret is refused with invalid_grant', async () => {
    // Which failed password grants count towards the user lockout is undocumented, so the wrong
    // secret is paired with a username that cannot exist: no real account is hit.
    const client = newLiveClient(config, {
      consumerSecret: `${config.consumerSecret}-wrong`,
      username: `${config.username}-sdk-live-absent`,
    });
    const error = await refused('auth.wrong-client-secret', client.gateway.listBanks());
    expect(error).toMatchObject({ kind: 'api', code: 'invalid_grant' });
  });
});
