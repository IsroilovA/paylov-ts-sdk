/** Compile-time contracts for `client.gateway`. */

import type { Bank, GatewayResource, PaylovClient } from '../../src/index.js';

declare const client: PaylovClient;
const gateway: GatewayResource = client.gateway;

const status: Promise<void> = gateway.getStatus({ signal: AbortSignal.timeout(5_000) });
void status;

const banks: readonly Bank[] = await gateway.listBanks();
const firstBank = banks[0];
if (firstBank !== undefined) {
  const bankId: string = firstBank.bankId;
  const officialName: string | null = firstBank.officialName;
  void [bankId, officialName];
  // @ts-expect-error bank ids are strings that match a card's bankId
  const numericId: number = firstBank.bankId;
  void numericId;
  // @ts-expect-error the result is read-only
  firstBank.name = 'renamed';
}
// @ts-expect-error call options carry only an AbortSignal
void gateway.listBanks({ signal: 'soon' });
