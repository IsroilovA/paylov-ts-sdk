/** Compile-time contracts for `client.subMerchants`. */

import {
  type PaylovClient,
  type CreateSubMerchantParams,
  type SubMerchantCreated,
  type SubMerchantOrganization,
} from '../../src/index.js';

declare const client: PaylovClient;
declare const organization: SubMerchantOrganization;

const tinParams = { name: 'Shop', tin: '123654987' } satisfies CreateSubMerchantParams;
const byTin: Promise<SubMerchantCreated> = client.subMerchants.create(tinParams);
const byPinfl = { name: 'Shop', pinfl: '12345678901234' } satisfies CreateSubMerchantParams;
const byBoth: CreateSubMerchantParams = { name: 'Shop', tin: '123654987', pinfl: '12345678901234' };
const withOrganization: CreateSubMerchantParams = { name: 'Shop', tin: '123654987', organization };
// @ts-expect-error SDK names are camelCase; the wire key SPIC is not accepted
const wireSpic: CreateSubMerchantParams = { ...tinParams, SPIC: '1' };
// @ts-expect-error a sub-merchant needs a tin or a pinfl
const neither: CreateSubMerchantParams = { name: 'Shop' };
// @ts-expect-error a new organization needs a tin
const pinflOrganization: CreateSubMerchantParams = {
  name: 'Shop',
  pinfl: '12345678901234',
  organization,
};
void [byTin, byPinfl, byBoth, withOrganization, wireSpic, neither, pinflOrganization];
