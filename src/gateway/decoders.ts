import {
  arrayOf,
  asLiteral,
  asNonNegativeInteger,
  asString,
  fieldOf,
  nullable,
  readFields,
  type Decoder,
} from '../core/decoding.js';
import type { Bank } from './types.js';

export const decodeStatus: Decoder<void> = (value, path) => {
  fieldOf('status', asLiteral('ok'))(value, path);
};

const decodeBank: Decoder<Bank> = (value, path) => {
  const field = readFields(value, path);
  return {
    bankId: String(field('id', asNonNegativeInteger)),
    name: field('name', asString),
    officialName: field('official_name', nullable(asString)),
  };
};

export const decodeBanks: Decoder<readonly Bank[]> = arrayOf(decodeBank);
