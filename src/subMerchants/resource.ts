import { readCall, send } from '../core/call.js';
import type { Params } from '../core/params.js';
import type { HttpClient, PaylovCallOptions } from '../core/types.js';
import { decodeSubMerchantCreated } from './decoders.js';
import type { CreateSubMerchantParams, SubMerchantCreated } from './types.js';

export const ENDPOINTS = {
  create: { method: 'POST', route: '/merchant/subMerchant/merchant-create/', shape: 'envelope' },
} as const;

/**
 * The `paylov.subMerchants` namespace. Needs sub-merchant creation enabled for the merchant;
 * otherwise `permission_denied`.
 */
export interface SubMerchantsResource {
  /**
   * Creates a child merchant under yours; Paylov staff activate it later. Moves no money. Tax ids,
   * director and bank details never reach logger events or errors.
   *
   * Recovery: no lookup exists. When `isPaylovOutcomeUnknown(error)`, repeat the call with the
   * same data; `sub_merchant_already_created` then means it exists.
   *
   * @throws {@link PaylovApiError} `sub_merchant_already_created` (the `name`, `tin`, `pinfl` or
   * `externalId` is taken among your sub-merchants), `validation_error` (`fields` names wire
   * fields such as `organization.oked` or `non_field_errors`), `rate_limit_exceeded` (more than
   * 100 calls per minute), `permission_denied`.
   *
   * @example
   * const { subMerchantId } = await paylov.subMerchants.create({
   *   name: shop.displayName,
   *   tin: shop.tin,
   *   externalId: shop.id,
   *   ofdVatPercent: 12,
   * });
   * await shops.linkPaylov(shop.id, subMerchantId);
   */
  create(params: CreateSubMerchantParams, options?: PaylovCallOptions): Promise<SubMerchantCreated>;
}

interface WireOrganization {
  readonly name: string;
  readonly director_pinfl: string;
  readonly account_number: string;
  readonly oked: string;
  readonly legal_name: string | undefined;
  readonly director_fio: string | undefined;
  readonly director_passport: string | undefined;
  readonly director_passport_valid_to: string | undefined;
  readonly director_birth_date: string | undefined;
  readonly director_nationality: string | undefined;
  readonly dr_nationality_for_uzcard: string | undefined;
  readonly dr_nationality_for_humo: string | undefined;
  readonly mfo: string | undefined;
}

function readOrganization(organization: Params): WireOrganization {
  return {
    name: organization.string('name'),
    director_pinfl: organization.string('directorPinfl'),
    account_number: organization.string('accountNumber'),
    oked: organization.string('oked'),
    legal_name: organization.optionalString('legalName'),
    director_fio: organization.optionalString('directorFullName'),
    director_passport: organization.optionalString('directorPassport'),
    director_passport_valid_to: organization.optionalString('directorPassportValidTo'),
    director_birth_date: organization.optionalString('directorBirthDate'),
    director_nationality: organization.optionalString('directorNationality'),
    dr_nationality_for_uzcard: organization.optionalString('directorNationalityUzcard'),
    dr_nationality_for_humo: organization.optionalString('directorNationalityHumo'),
    mfo: organization.optionalString('mfo'),
  };
}

export function createSubMerchantsResource(http: HttpClient): SubMerchantsResource {
  return {
    async create(params, options) {
      const method = 'subMerchants.create';
      const { input, signal } = readCall(params, options, method);
      const organization = input.optionalObject('organization', readOrganization);
      const pinfl = input.optionalString('pinfl');
      const needsTin = organization !== undefined || pinfl === undefined;
      const body = {
        name: input.string('name'),
        tin: needsTin ? input.string('tin') : input.optionalString('tin'),
        pinfl,
        external_id: input.optionalString('externalId'),
        create_new_organization: organization === undefined ? undefined : true,
        organization,
        self_employee_service: input.optionalBoolean('isSelfEmployed'),
        ofd_vat_percent: input.optionalInteger('ofdVatPercent'),
        SPIC: input.optionalString('spic'),
        spic_package_code: input.optionalString('spicPackageCode'),
      };
      return send(http, ENDPOINTS.create, { body, signal }, decodeSubMerchantCreated);
    },
  };
}
