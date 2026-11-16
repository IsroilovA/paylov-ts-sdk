import { describe, expect, it } from 'vitest';

import { createSubMerchantsResource } from '../../src/subMerchants/resource.js';
import {
  expectApiError,
  expectInputError,
  expectMalformed,
  expectNoSecretLeak,
  recordOf,
} from '../helpers/asserts.js';
import type { FakeResponseSpec } from '../helpers/fakeFetch.js';
import { fixtureResponse, wireResponse } from '../helpers/fixtures.js';
import { BASE_URL, setupResource } from '../helpers/testHttp.js';

const TIN = '900000001';
const PINFL = '99999999999991';
const DIRECTOR_PINFL = '99999999999992';
const PASSPORT = 'ZZ0000001';
const ACCOUNT_NUMBER = '99999000000000000001';
const DIRECTOR_NAME = 'EXAMPLE-DIRECTOR-NOT-A-REAL-PERSON';

const ORGANIZATION = {
  name: 'Example Shop LLC',
  directorPinfl: DIRECTOR_PINFL,
  accountNumber: ACCOUNT_NUMBER,
  oked: '47190',
};

function setup(...script: FakeResponseSpec[]) {
  return setupResource(createSubMerchantsResource, script);
}

describe('subMerchants.create', () => {
  it('maps every field to its snake_case wire name and accepts HTTP 201', async () => {
    const { resource, fetchImpl } = setup(
      fixtureResponse('subMerchants/create.success.docs.json', { status: 201 }),
    );

    const created = await resource.create({
      name: 'MrBeast',
      tin: TIN,
      pinfl: PINFL,
      externalId: 'shop-42',
      isSelfEmployed: false,
      ofdVatPercent: 12,
      spic: '10305008003000000',
      spicPackageCode: '1500988',
    });

    expect(fetchImpl.calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE_URL}/merchant/subMerchant/merchant-create/`,
    });
    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({
      name: 'MrBeast',
      tin: TIN,
      pinfl: PINFL,
      external_id: 'shop-42',
      self_employee_service: false,
      ofd_vat_percent: 12,
      SPIC: '10305008003000000',
      spic_package_code: '1500988',
    });
    expect(created).toEqual({
      subMerchantId: 'c467b929-b850-40ae-9e38-fb2827684bda',
      name: 'MrBeast',
    });
  });

  it('creates a new organization only when one is given', async () => {
    const { resource, fetchImpl } = setup(
      fixtureResponse('subMerchants/create.success.docs.json', { status: 201 }),
      fixtureResponse('subMerchants/create.success.docs.json', { status: 201 }),
    );

    await resource.create({ name: 'Solo', pinfl: PINFL });
    await resource.create({
      name: 'MrBeast',
      tin: TIN,
      organization: {
        ...ORGANIZATION,
        legalName: '"MRBEAST" LLC',
        directorFullName: DIRECTOR_NAME,
        directorPassport: PASSPORT,
        directorPassportValidTo: '2030-01-01',
        directorBirthDate: '1990-01-01',
        directorNationality: 'UZ',
        directorNationalityUzcard: 'UZB',
        directorNationalityHumo: '860',
        mfo: '00000',
      },
    });

    expect(recordOf(fetchImpl.calls[0]?.body)).toEqual({ name: 'Solo', pinfl: PINFL });
    expect(recordOf(fetchImpl.calls[1]?.body)).toEqual({
      name: 'MrBeast',
      tin: TIN,
      create_new_organization: true,
      organization: {
        name: 'Example Shop LLC',
        director_pinfl: DIRECTOR_PINFL,
        account_number: ACCOUNT_NUMBER,
        oked: '47190',
        legal_name: '"MRBEAST" LLC',
        director_fio: DIRECTOR_NAME,
        director_passport: PASSPORT,
        director_passport_valid_to: '2030-01-01',
        director_birth_date: '1990-01-01',
        director_nationality: 'UZ',
        dr_nationality_for_uzcard: 'UZB',
        dr_nationality_for_humo: '860',
        mfo: '00000',
      },
    });
  });

  it.each([
    [{ name: undefined }, 'name', 'required'],
    [{ tin: 900000001 }, 'tin', 'type'],
    [{ tin: undefined }, 'tin', 'required'],
    [{ tin: undefined, pinfl: PINFL, organization: ORGANIZATION }, 'tin', 'required'],
    [{ ofdVatPercent: 12.5 }, 'ofdVatPercent', 'type'],
    [{ organization: { ...ORGANIZATION, oked: 47190 } }, 'organization.oked', 'type'],
    [{ organization: 'Example Shop LLC' }, 'organization', 'type'],
  ] as const)('rejects %j before any request', async (override, field, rule) => {
    const { resource, fetchImpl } = setup();

    await expectInputError(resource.create({ name: 'Shop', tin: TIN, ...override } as never), {
      field,
      rule,
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('keeps tax ids, director and bank data out of input errors', async () => {
    const params = {
      name: 'Shop',
      tin: TIN,
      pinfl: PINFL,
      organization: {
        ...ORGANIZATION,
        directorFullName: DIRECTOR_NAME,
        directorPassport: PASSPORT,
        oked: 47190,
      },
    };

    const error = await expectInputError(setup().resource.create(params as never), {
      field: 'organization.oked',
      rule: 'type',
    });
    expectNoSecretLeak(error, [
      TIN,
      PINFL,
      DIRECTOR_PINFL,
      ACCOUNT_NUMBER,
      DIRECTOR_NAME,
      PASSPORT,
    ]);
  });

  it('keeps sensitive values out of gateway errors and logger events', async () => {
    const { resource, requests, responses } = setup(
      fixtureResponse('subMerchants/create.organizationValidation.synthesized.json', {
        status: 400,
      }),
    );

    const error = await expectApiError(
      resource.create({
        name: 'Shop',
        tin: TIN,
        organization: { ...ORGANIZATION, directorFullName: DIRECTOR_NAME },
      }),
      { code: 'validation_error', fields: ['organization.director_pinfl', 'non_field_errors'] },
    );
    const secrets = [TIN, DIRECTOR_PINFL, ACCOUNT_NUMBER, DIRECTOR_NAME, 'EXAMPLE-DIRECTOR-PINFL'];
    expectNoSecretLeak(error, secrets);
    expectNoSecretLeak([...requests, ...responses], secrets);
  });

  it('sends a short TIN unchanged and reports the live TIN rule under non_field_errors', async () => {
    const { resource, fetchImpl } = setup(wireResponse('subMerchants/create.badTin.wire.json'));

    await expectApiError(resource.create({ name: 'Shop', tin: '12' }), {
      code: 'validation_error',
      fields: ['non_field_errors'],
    });
    expect(fetchImpl.calls[0]?.body).toEqual({ name: 'Shop', tin: '12' });
  });

  it('surfaces sub_merchant_already_created', async () => {
    const { resource } = setup(
      fixtureResponse('subMerchants/create.alreadyCreated.docs.json', { status: 400 }),
    );

    await expectApiError(resource.create({ name: 'Shop', tin: TIN }), {
      code: 'sub_merchant_already_created',
    });
  });

  it('requires the sub-merchant id in the result', async () => {
    const { resource } = setup({ status: 201, body: { result: { name: 'Shop' } } });

    await expectMalformed(resource.create({ name: 'Shop', tin: TIN }), 'result.id');
  });
});
