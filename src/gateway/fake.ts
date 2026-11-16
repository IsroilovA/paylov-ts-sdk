import type { PaylovFakeSurface, Scripter } from '../core/fake.js';
import { ENDPOINTS, type GatewayResource } from './resource.js';
import type { Bank } from './types.js';

function encodeStatus(): unknown {
  return { status: 'ok' };
}

/** A `bankId` that is not a decimal integer cannot come from the gateway and fails decoding. */
function encodeBanks(banks: readonly Bank[]): unknown {
  return banks.map((bank) => ({
    id: Number(bank.bankId),
    name: bank.name,
    official_name: bank.officialName,
  }));
}

function decodeNoParams(): undefined {
  return undefined;
}

export function createGatewayFake(
  script: Scripter<'gateway', GatewayResource>,
): PaylovFakeSurface<GatewayResource> {
  return {
    getStatus: script('gateway.getStatus', ENDPOINTS.getStatus, encodeStatus, decodeNoParams),
    listBanks: script('gateway.listBanks', ENDPOINTS.listBanks, encodeBanks, decodeNoParams),
  };
}
