---
source_url: https://developer.paylov.uz/subscribe/get-single-card
---

# Get Single Card

### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL/`merchant/userCard/getCard/{cardId}/`<br>**Header:**

```http
Authorization: Bearer < ACCESS_TOKEN >
```

| Path | Type | Required |
| --- | --- | --- |
| cardId | string | Yes |

## Success response

```json
{
  "result": {
    "card": {
      "userId": "707",
      "cardId": "66634c5b-e5d9-4b2c-b95c-fc14da331830",
      "owner": "Levi A.",
      "cardName": "string",
      "number": "986034******9999",
      "balance": 24032775200,
      "expireDate": "2909",
      "bankId": "32",
      "vendor": "Humo",
      "processing": "Humo",
      "status": {
        "result": {
          "is_active": true,
          "status_message": "active",
          "sms_info": true
        }
      }
    }
  }
}
```

> balance in tiyn: 100 = 1 Sum

## Error response

```json
{
  "error": {
    "code": "card_not_found_in_processing_center",
    "message": "card_not_found"
  }
}
```

## Error codes of the method

| Code | Message | Description |
| --- | --- | --- |
| card_not_found_in_processing_center | card_not_found |  |
| card_is_blocked_in_processing_center |  |  |
| card_is_blocked | card is inactive or blocked in processing center (in Uzcard/Humo) |  |
| balance_refresh_error | balance_refresh_error |  |
| card_not_found | card_not_found | card not found in Paylov system |

## Success response when card status not active

```json
{
  "result": {
    "card": {
      "userId": "32",
      "cardId": "1a11a111-b6c1-43c2-b1ae-ee3f7b51231f",
      "owner": "Levi A.",
      "cardName": "",
      "number": "561468******1311",
      "balance": 150000,
      "expireDate": "2505",
      "bankId": "13",
      "vendor": "MIR",
      "processing": "Uzcard",
      "status": {
        "result": {
          "is_active": false,
          "status_message": "stolen_card_capture",
          "sms_info": true
        }
      }
    }
  }
}
```

## Card status messages

> 💡 **Note:** The `status_message` = `active` when `is_active` = `true`.

active<br> call_issuer<br> warm_card do_not_honor<br> honor_with_id<br> not_permitted<br> lost_card_capture<br> stolen_card_capture<br> call_security_capture<br> invalid_card_capture<br> pick_up_card_special_condition<br> call_acquirer_security<br> temporary_blocked_by_user<br> pin_attempts_exceeded<br> forced_pin_change<br> credit_debts<br> unknown<br> pin_activation<br> instant_card_personification_waiting<br> fraud_prevention<br> permanent_blocked_by_client<br> temporary_blocked_by_client<br> decline_restricted_card<br> decline_card_not_effective<br> pick_up_restricted_card<br> pick_up_special_conditions<br> pick_up_lost_card<br> pick_up_stolen_card<br> decline_card_not_active_at_bank_will<br> decline_card_not_active_at_cardholder_will

## Notes (extraction)
- EN/RU error table splits card_is_blocked_in_processing_center and card_is_blocked across two rows with empty cells; UZ combines them as code/message and supplies missing descriptions for processing-center card-not-found and balance_refresh_error. RU translates status values active and unknown into Russian prose; EN/UZ retain those literal codes. UZ explicitly explains cardId.
