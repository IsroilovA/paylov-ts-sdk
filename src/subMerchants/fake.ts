import {
  optionalEntry,
  type FakeRequest,
  type PaylovFakeSurface,
  type Scripter,
} from '../core/fake.js';
import type { Params } from '../core/params.js';
import { ENDPOINTS, type SubMerchantsResource } from './resource.js';
import type {
  CreateSubMerchantParams,
  SubMerchantCreated,
  SubMerchantOrganization,
} from './types.js';

function encodeSubMerchantCreated(created: SubMerchantCreated): unknown {
  return { id: created.subMerchantId, name: created.name };
}

function decodeOrganization(organization: Params): SubMerchantOrganization {
  const optionalField = <K extends keyof SubMerchantOrganization>(field: K, key: string) =>
    optionalEntry(field, organization.optionalString(key));
  return {
    name: organization.string('name'),
    directorPinfl: organization.string('director_pinfl'),
    accountNumber: organization.string('account_number'),
    oked: organization.string('oked'),
    ...optionalField('legalName', 'legal_name'),
    ...optionalField('directorFullName', 'director_fio'),
    ...optionalField('directorPassport', 'director_passport'),
    ...optionalField('directorPassportValidTo', 'director_passport_valid_to'),
    ...optionalField('directorBirthDate', 'director_birth_date'),
    ...optionalField('directorNationality', 'director_nationality'),
    ...optionalField('directorNationalityUzcard', 'dr_nationality_for_uzcard'),
    ...optionalField('directorNationalityHumo', 'dr_nationality_for_humo'),
    ...optionalField('mfo', 'mfo'),
  };
}

function decodeCreateRequest({ body }: FakeRequest): CreateSubMerchantParams {
  const tin = body.optionalString('tin');
  const taxIds =
    tin === undefined
      ? { pinfl: body.string('pinfl') }
      : {
          tin,
          ...optionalEntry('pinfl', body.optionalString('pinfl')),
          ...optionalEntry('organization', body.optionalObject('organization', decodeOrganization)),
        };
  return {
    name: body.string('name'),
    ...taxIds,
    ...optionalEntry('externalId', body.optionalString('external_id')),
    ...optionalEntry('isSelfEmployed', body.optionalBoolean('self_employee_service')),
    ...optionalEntry('ofdVatPercent', body.optionalInteger('ofd_vat_percent')),
    ...optionalEntry('spic', body.optionalString('SPIC')),
    ...optionalEntry('spicPackageCode', body.optionalString('spic_package_code')),
  };
}

export function createSubMerchantsFake(
  script: Scripter<'subMerchants', SubMerchantsResource>,
): PaylovFakeSurface<SubMerchantsResource> {
  return {
    create: script(
      'subMerchants.create',
      ENDPOINTS.create,
      encodeSubMerchantCreated,
      decodeCreateRequest,
    ),
  };
}
