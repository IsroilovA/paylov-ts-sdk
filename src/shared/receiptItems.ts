/**
 * Fiscal receipt items, shared by fiscalization and splits. Prices and discounts are tiyin both
 * here and on the wire.
 */

import type { Params } from '../core/params.js';

/** Fields every receipt item carries besides its `tin` or `pinfl`. */
export interface FiscalReceiptItemBase {
  /** Item name as it appears on the fiscal receipt. */
  readonly title: string;
  /**
   * Integer tiyin, the price of one unit before discount. The SDK assumes a line totals
   * `(priceTiyin - discountTiyin) * count`; Paylov documents no formula.
   */
  readonly priceTiyin: number;
  /** Integer tiyin off each unit; Paylov allows at most `priceTiyin`. */
  readonly discountTiyin?: number;
  /** Integer quantity; Paylov answers `validation_error` below 1. */
  readonly count: number;
  /** IKPU classifier code of the item. */
  readonly code: string;
  /** Integer VAT percentage. */
  readonly vatPercent: number;
  /** Package-type code. */
  readonly packageCode: string;
}

/** One receipt line, carrying exactly one of `tin` or `pinfl`. */
export type FiscalReceiptItem =
  | (FiscalReceiptItemBase & {
      /** Taxpayer id (INN) of the commitent; Paylov documents 9 digits. */
      readonly tin: string;
      // `?: undefined`, not `?: never`, so items built by spread still type-check under
      // `exactOptionalPropertyTypes`.
      readonly pinfl?: undefined;
    })
  | (FiscalReceiptItemBase & {
      /**
       * Personal identification number; Paylov documents 14 digits. Personal data; never logged or
       * quoted.
       */
      readonly pinfl: string;
      readonly tin?: undefined;
    });

/** The wire form of one item; an undefined `discount` is left out of the JSON body. */
export interface WireReceiptItem {
  readonly title: string;
  readonly price: number;
  readonly discount: number | undefined;
  readonly count: number;
  readonly code: string;
  readonly vat_percent: number;
  readonly package_code: string;
  readonly tin?: string;
  readonly pinfl?: string;
}

/** Reads one item; use with `params.array` or `params.optionalArray`. */
export function readReceiptItem(item: Params): WireReceiptItem {
  const base = {
    title: item.string('title'),
    price: item.tiyin('priceTiyin'),
    discount: item.optionalTiyin('discountTiyin'),
    count: item.integer('count'),
    code: item.string('code'),
    vat_percent: item.integer('vatPercent'),
    package_code: item.string('packageCode'),
  };
  return item.exclusive(['tin', 'pinfl']) === 'tin'
    ? { ...base, tin: item.string('tin') }
    : { ...base, pinfl: item.string('pinfl') };
}
