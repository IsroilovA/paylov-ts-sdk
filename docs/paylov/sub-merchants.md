---
sources:
  - https://developer.paylov.uz/sub_process/sub_merchant
  - https://developer.paylov.uz/uz/subscribe/sub_merchant_create
---

# Sub-merchants

Creates a child merchant under the calling merchant (D). Vendor pages:
[en](../vendor/paylov/sub_process/sub_merchant.md),
[uz](../vendor/paylov/uz/subscribe/sub_merchant_create.md). Grades: [evidence](README.md#evidence).

## Flow

The parent merchant submits the child's name and tax identity, using the parent's organization or a
new one (D). A `201` returns the child's id and name; Paylov staff then activate it, and no endpoint
reads, lists or reports the activation of sub-merchants (D). Creation moves no money; OFD settings
describe the child (D). Whether the id is a [split recipient id](splits.md#recipients) is
undocumented. A duplicate within the same parent answers `sub_merchant_already_created`, with no
documented way to find the existing child (D). On DEV the permission gate prevents a successful
create (W c301, c1453).

## Create sub-merchant

`POST {BASE_URL}/merchant/subMerchant/merchant-create/`

| Name                      | Type    | Required    | Description                                                                                                            | Grade       |
| ------------------------- | ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ----------- |
| `name`                    | string  | Yes         | Sub-merchant name, 1–128 characters.                                                                                   | W (c300), D |
| `tin`                     | string  | Conditional | Organization TIN (INN), exactly 9 digits; a wrong length fails in `non_field_errors` ("TIN must consist of 9 digits"). | W (c302), D |
| `pinfl`                   | string  | Conditional | Individual's PINFL, exactly 14 digits.                                                                                 | D           |
| `external_id`             | string  | No          | The merchant's own id, 1–64 characters; `{}` does not report it.                                                       | W (c300), D |
| `create_new_organization` | boolean | No          | Default `false`. `true` creates a new organization from `organization`; `false` uses the parent merchant's.            | D           |
| `organization`            | object  | Conditional | [Organization](#organization-object); required when `create_new_organization` is `true`.                               | D           |
| `self_employee_service`   | boolean | No          | Default `false`. Self-employed service (OFD).                                                                          | D           |
| `ofd_vat_percent`         | integer | No          | VAT percent for OFD, 0–100.                                                                                            | D           |
| `SPIC`                    | string  | No          | SPIC (IKPU) code, up to 64 characters. The key is uppercase.                                                           | D           |
| `spic_package_code`       | string  | No          | SPIC package code, up to 20 characters.                                                                                | D           |

At least one of `tin` and `pinfl` is required, and both may be sent together, unlike
[receipt items](fiscalization.md#item-object). With `create_new_organization: true`, `tin` and
`organization` are required (D). Rule failures arrive in `data.non_field_errors`; organization field
failures in `data.organization.<field>` (D).

### Organization object

Director, passport and bank fields are personal or banking data.

| Name                         | Type   | Required | Description                                            |
| ---------------------------- | ------ | -------- | ------------------------------------------------------ |
| `name`                       | string | Yes      | Organization name, up to 256 characters.               |
| `director_pinfl`             | string | Yes      | Director's PINFL, exactly 14 digits.                   |
| `account_number`             | string | Yes      | Bank account number, digits only, up to 32 characters. |
| `oked`                       | string | Yes      | OKED code, exactly 5 digits.                           |
| `legal_name`                 | string | No       | Legal name, up to 256 characters.                      |
| `director_fio`               | string | No       | Director's full name, up to 256 characters.            |
| `director_passport`          | string | No       | Passport series and number, up to 9 characters.        |
| `director_passport_valid_to` | date   | No       | Passport expiry, `YYYY-MM-DD`.                         |
| `director_birth_date`        | date   | No       | Director's birth date, `YYYY-MM-DD`.                   |
| `director_nationality`       | string | No       | Nationality, up to 2 characters.                       |
| `dr_nationality_for_uzcard`  | string | No       | Nationality code for Uzcard, up to 3 characters.       |
| `dr_nationality_for_humo`    | string | No       | Nationality code for Humo, up to 3 characters.         |
| `mfo`                        | string | No       | Bank MFO, up to 10 characters.                         |

All organization facts are D.

Success: HTTP `201`, D ([fixture](../../tests/fixtures/subMerchants/create.success.docs.json)):

```json
{
  "result": {
    "id": "c467b929-b850-40ae-9e38-fb2827684bda",
    "name": "MrBeast"
  }
}
```

| Field  | Type          | Description        |
| ------ | ------------- | ------------------ |
| `id`   | string (UUID) | Sub-merchant id.   |
| `name` | string        | Sub-merchant name. |

| Code                           | HTTP | Description                                                                                                                                                                                         | Grade                          |
| ------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `validation_error`             | 400  | Field map (`{}` gives `{"name": [...]}`), `non_field_errors` for the tax-id and organization rules, `organization.<field>` for organization fields                                                  | W (c300, c302, c1455–c1469), D |
| `permission_denied`            | 400  | The merchant may not create sub-merchants                                                                                                                                                           | W (c301, c1453), D             |
| `method_not_allowed`           | 405  | `GET` instead of `POST`                                                                                                                                                                             | W (c305)                       |
| `sub_merchant_already_created` | 400  | A sub-merchant of the same parent has the same `name`, `tin`, `pinfl` or `external_id` ([fixture](../../tests/fixtures/subMerchants/create.alreadyCreated.docs.json))                               | D                              |
| `rate_limit_exceeded`          | 429  | More than 100 requests per 60 seconds; the page says to wait the seconds in the `Retry-After` header and shows no body. On DEV, 15 concurrent `{}` bodies all answered `validation_error`, none 429 | D; W (c1455–c1469)             |

## Deviations from vendor docs

- The success example omits the `error` key that other success envelopes carry.
- The page lists `rate_limit_exceeded` without an example body; whether its message carries the
  `Retry after Ns` text the token endpoint uses is unknown.
- The sandbox bundle's paths `sub-merchant/create/` and `subMerchant/transfer/` do not exist:
  `404 not_found` (W c303, c304).
