---
source_url: https://developer.paylov.uz/sub_process/sub_merchant
---

# Sub Merchants

## 1. Sub Merchant Create API

**Description:**<br> API for creating a sub-merchant. If a merchant wants to create a child merchant, this API is used.

> 💡 **Note:** the created sub-merchant is activated by staff members.

> 💡 **Note:** the merchant must have permission to create sub-merchants. Otherwise, the `permission_denied` error is returned.

## 

#### Endpoint details

> **Method:** `POST`<br>**URL:** BASE_URL/`merchant/subMerchant/merchant-create/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

**Request body**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Sub-merchant name. 1–128 characters |
| `tin` | string | Conditional | TIN (INN) of the organization. Exactly 9 digits |
| `pinfl` | string | Conditional | Individual's PINFL (JSHSHIR). Exactly 14 digits |
| `external_id` | string | No | Sub-merchant ID in your system. 1–64 characters |
| `create_new_organization` | bool | No | Default `false`. If `true`, a new organization is created for the sub-merchant from the `organization` data. If `false`, the parent merchant's organization is used |
| `organization` | object | Conditional | Organization data. Required if `create_new_organization` is `true` |
| `self_employee_service` | bool | No | Default `false`. Self-employed service (OFD) |
| `ofd_vat_percent` | int | No | VAT percent for OFD. From `0` to `100` |
| `SPIC` | string | No | SPIC (IKPU) code. Up to 64 characters. The field name is written in uppercase |
| `spic_package_code` | string | No | SPIC package code. Up to 20 characters |

> 💡 **Note:** at least one of `tin` or `pinfl` must be provided. Both can be sent together.

> 💡 **Note:** if `create_new_organization` is `true`, `tin` and `organization` are required.

**`organization` object**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Organization name. Up to 256 characters |
| `director_pinfl` | string | Yes | Director's PINFL. Exactly 14 digits |
| `account_number` | string | Yes | Bank account number. Digits only, up to 32 characters |
| `oked` | string | Yes | OKED code. Exactly 5 digits |
| `legal_name` | string | No | Legal name. Up to 256 characters |
| `director_fio` | string | No | Director's full name. Up to 256 characters |
| `director_passport` | string | No | Director's passport series and number. Up to 9 characters |
| `director_passport_valid_to` | date | No | Passport expiry date. `YYYY-MM-DD` |
| `director_birth_date` | date | No | Director's birth date. `YYYY-MM-DD` |
| `director_nationality` | string | No | Director's nationality. Up to 2 characters |
| `dr_nationality_for_uzcard` | string | No | Director's nationality code for Uzcard. Up to 3 characters |
| `dr_nationality_for_humo` | string | No | Director's nationality code for Humo. Up to 3 characters |
| `mfo` | string | No | Bank MFO. Up to 10 characters |

## Request example

Using the parent merchant's organization:

```json
{
  "name": "MrBeast",
  "tin": "123654987",
  "pinfl": "12345678901234",
  "external_id": "Someone External Id",
  "self_employee_service": false,
  "ofd_vat_percent": 12,
  "SPIC": "10305008003000000",
  "spic_package_code": "1500988"
}
```

Creating a new organization:

```json
{
  "name": "MrBeast",
  "tin": "123654987",
  "external_id": "Someone External Id",
  "create_new_organization": true,
  "organization": {
    "name": "MrBeast LLC",
    "legal_name": "\"MRBEAST\" LLC",
    "director_fio": "Ivanov Ivan Ivanovich",
    "director_passport": "AA1234567",
    "director_pinfl": "12345678901234",
    "director_passport_valid_to": "2030-01-01",
    "director_birth_date": "1990-01-01",
    "director_nationality": "UZ",
    "account_number": "20208000900000000001",
    "mfo": "00000",
    "oked": "47190"
  }
}
```

## Response example

HTTP status: `201`

```json
{
  "result": {
    "id": "c467b929-b850-40ae-9e38-fb2827684bda",
    "name": "MrBeast"
  }
}
```

## Error response

| Code | HTTP | Description |
| --- | --- | --- |
| `validation_error` | 400 | Request body is invalid |
| `permission_denied` | 400 | The merchant is not allowed to create sub-merchants |
| `sub_merchant_already_created` | 400 | A sub-merchant with the same `name`, `tin`, `pinfl` or `external_id` already exists under this merchant |
| `rate_limit_exceeded` | 429 | More than 100 requests per 60 seconds. Retry after the number of seconds in the `Retry-After` header |

> 💡 **Note:** duplicates are checked only among the sub-merchants of the same parent merchant. If any of `name`, `tin`, `pinfl` or `external_id` matches an existing sub-merchant, a new one is not created.

```json
{
  "result": null,
  "error": {
    "code": "sub_merchant_already_created",
    "message": "Sub Merchant Already Created..."
  }
}
```

Validation error example. Errors of `tin` / `pinfl` and `create_new_organization` rules are returned in `data.non_field_errors`, errors of `organization` fields are returned in `data.organization.<field>`:

```json
{
  "result": null,
  "error": {
    "code": "validation_error",
    "message": "validation_error",
    "data": {
      "non_field_errors": [
        "At least one of TIN or PINFL must be provided"
      ]
    }
  }
}
```

## Notes (extraction)

- The source contains an empty level-two heading before "Endpoint details" (EN and RU). Public sample identity values are retained: `tin` 123654987, `pinfl` and `director_pinfl` 12345678901234, `director_passport` AA1234567, `director_fio` "Ivanov Ivan Ivanovich", `account_number` 20208000900000000001.
- The success example omits the `error` key that other Paylov response envelopes carry. The error table lists `permission_denied` with HTTP 400, not 403. `rate_limit_exceeded` has no example body.
- EN and RU agree on endpoint, fields, types, required flags, length and format limits, rules, HTTP statuses, error codes and examples. The only code difference is the second request example's `organization.legal_name`: EN `"\"MRBEAST\" LLC"`, RU `"ООО \"MRBEAST\""`.
- The corresponding /uz/sub_process/sub_merchant URL (and .html) returns HTTP 404 although the page's language switcher links to it, and hashmap.json has no `uz_sub_process_sub_merchant.md` key. The separately linked Uzbek-only /uz/subscribe/sub_merchant_create page carries the same contract, with `legal_name` `"\"MRBEAST\" MChJ"`. It has "Endpoint details" as a level-two heading and no empty heading.
