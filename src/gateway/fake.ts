import type { FakeSpecTable } from '../core/fake.js';
import { ENDPOINTS, type GatewayResource } from './resource.js';
import type { Bank } from './types.js';

function encodeStatus(): unknown {
  return { status: 'ok' };
}

/** The wire integer id the SDK reads back as exactly `bankId`, its decimal digits. */
function encodeBankId(bankId: string): number {
  const id = Number(bankId);
  if (!Number.isSafeInteger(id) || id < 0 || String(id) !== bankId) {
    throw new TypeError('bankId must be a non-negative integer in plain decimal digits');
  }
  return id;
}

function encodeBanks(banks: readonly Bank[]): unknown {
  return banks.map((bank) => ({
    id: encodeBankId(bank.bankId),
    name: bank.name,
    official_name: bank.officialName,
  }));
}

function decodeNoParams(): undefined {
  return undefined;
}

export const GATEWAY_FAKES: FakeSpecTable<GatewayResource> = {
  getStatus: {
    endpoint: ENDPOINTS.getStatus,
    encode: encodeStatus,
    decodeRequest: decodeNoParams,
  },
  listBanks: {
    endpoint: ENDPOINTS.listBanks,
    encode: encodeBanks,
    decodeRequest: decodeNoParams,
  },
};
