import { asString, readFields, type Decoder } from '../core/decoding.js';
import type { SubMerchantCreated } from './types.js';

/** `subMerchant/merchant-create/` result. */
export const decodeSubMerchantCreated: Decoder<SubMerchantCreated> = (value, path) => {
  const field = readFields(value, path);
  return { subMerchantId: field('id', asString), name: field('name', asString) };
};
