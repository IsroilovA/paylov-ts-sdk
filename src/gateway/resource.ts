import { send } from '../core/call.js';
import { readCallSignal } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { decodeBanks, decodeStatus } from './decoders.js';
import type { Bank } from './types.js';

export const ENDPOINTS = {
  getStatus: { method: 'GET', route: '/merchant/status/', shape: 'flat', effect: 'read' },
  listBanks: { method: 'GET', route: '/merchant/bankList/', shape: 'array', effect: 'read' },
} as const;

/** The `paylov.gateway` namespace. */
export interface GatewayResource {
  /**
   * Checks that the gateway answers (`GET /merchant/status/`). It sends no token and Paylov
   * validates none, so it proves neither the credentials nor the account: use it as a liveness
   * probe only. Moves no money. Resolves for `{"status":"ok"}`; any other answer throws.
   *
   * @throws {@link PaylovConnectionError} when the gateway is unreachable or times out.
   * @throws {@link PaylovProtocolError} `sdk_malformed_response` for any other success body.
   *
   * @example
   * try {
   *   await paylov.gateway.getStatus({ signal: AbortSignal.timeout(5_000) });
   *   return { paylov: 'up' };
   * } catch {
   *   return { paylov: 'down' };
   * }
   */
  getStatus(options?: PaylovCallOptions): Promise<void>;

  /**
   * Lists the banks Paylov knows (`GET /merchant/bankList/`). Each `bankId` is a string that
   * matches a card's `bankId`. Moves no money.
   *
   * @throws {@link PaylovApiError} `invalid_grant` when the credentials are rejected,
   * `permission_denied` when the gateway rejects the token even after the SDK's single replay.
   *
   * @example
   * const banks = await paylov.gateway.listBanks();
   * const bankNames = new Map(banks.map((bank) => [bank.bankId, bank.officialName ?? bank.name]));
   */
  listBanks(options?: PaylovCallOptions): Promise<readonly Bank[]>;
}

/** `anonymousHttp` sends no `Authorization`: `status/` needs none and must not trigger a login. */
export function createGatewayResource(
  http: HttpClient,
  anonymousHttp: HttpClient,
): GatewayResource {
  return {
    async getStatus(options) {
      const signal = readCallSignal(options, 'gateway.getStatus');
      return send(anonymousHttp, ENDPOINTS.getStatus, { signal }, decodeStatus);
    },

    async listBanks(options) {
      const signal = readCallSignal(options, 'gateway.listBanks');
      return send(http, ENDPOINTS.listBanks, { signal }, decodeBanks);
    },
  };
}
