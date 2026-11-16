/** The fields of `CreateSubMerchantParams` beside its tax ids. */
interface SubMerchantProfile {
  /** 1 to 128 characters; unique among your sub-merchants. */
  readonly name: string;
  /** Your own sub-merchant id, 1 to 64 characters; unique among your sub-merchants. */
  readonly externalId?: string;
  /** Enables the self-employed OFD service. Default `false`. */
  readonly isSelfEmployed?: boolean;
  /** Integer VAT percentage for OFD receipts, 0 to 100. */
  readonly ofdVatPercent?: number;
  /** SPIC (IKPU) classifier code, at most 64 characters. */
  readonly spic?: string;
  /** SPIC package code, at most 20 characters. */
  readonly spicPackageCode?: string;
}

/**
 * Parameters for `subMerchants.create`: a `tin`, a `pinfl`, or both. With `organization`, Paylov
 * creates a new organization for the sub-merchant, which needs a `tin`; without it the
 * sub-merchant uses your organization. The lengths and formats stated here are Paylov's; a value
 * that breaks one of these rules fails with `validation_error`.
 */
export type CreateSubMerchantParams = SubMerchantProfile &
  (
    | {
        /** Organization TIN (INN), 9 digits. */
        readonly tin: string;
        /** Individual's PINFL, 14 digits. Personal data; never logged or quoted. */
        readonly pinfl?: string;
        /** A new organization for the sub-merchant. */
        readonly organization?: SubMerchantOrganization;
      }
    | {
        /** Individual's PINFL, 14 digits. Personal data; never logged or quoted. */
        readonly pinfl: string;
        // `?: undefined`, not `?: never`, so params built by spread still type-check under
        // `exactOptionalPropertyTypes`.
        readonly tin?: undefined;
        readonly organization?: undefined;
      }
  );

/**
 * A new organization for the sub-merchant. Director, passport and bank fields are personal or
 * banking data. The lengths and formats stated here are Paylov's; a value that breaks one fails
 * with `validation_error` on `organization.<field>`.
 */
export interface SubMerchantOrganization {
  /** At most 256 characters. */
  readonly name: string;
  /** 14 digits. */
  readonly directorPinfl: string;
  /** Bank account number, up to 32 digits. */
  readonly accountNumber: string;
  /** OKED activity code, 5 digits. */
  readonly oked: string;
  /** At most 256 characters. */
  readonly legalName?: string;
  /** The director's full name, at most 256 characters. */
  readonly directorFullName?: string;
  /** Passport series and number, at most 9 characters. */
  readonly directorPassport?: string;
  /** `YYYY-MM-DD`. */
  readonly directorPassportValidTo?: string;
  /** `YYYY-MM-DD`. */
  readonly directorBirthDate?: string;
  /** At most 2 characters, e.g. `UZ`. */
  readonly directorNationality?: string;
  /** Nationality code for Uzcard, at most 3 characters. */
  readonly directorNationalityUzcard?: string;
  /** Nationality code for Humo, at most 3 characters. */
  readonly directorNationalityHumo?: string;
  /** Bank MFO code, at most 10 characters. */
  readonly mfo?: string;
}

/** Result of `subMerchants.create`. */
export interface SubMerchantCreated {
  readonly subMerchantId: string;
  readonly name: string;
}
