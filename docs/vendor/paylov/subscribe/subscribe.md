---
source_url: https://developer.paylov.uz/subscribe/subscribe
---

# Subscribe API

### Error structure example

```json
{
  "result": null,
  "error": {
    "code": "invalid_card",
    "message": "invalid_card",
		"data": {} // dict or string, Null
  }
}

# 'data' field might not be in error response
```

### Error codes

```python
UNKNOWN_ERROR = "unknown_error"
INVALID_OTP = "invalid_otp"
CARD_IS_BLOCKED = "card_is_blocked"
CARD_EXISTS = "card_exists"
CARD_NOT_FOUND = "card_not_found"
CARD_EXPIRED = "card_expired"
FIELD_REQUIRED = "field_required"
INSUFFICIENT_FUNDS = "insufficient_funds"
VALIDATION_ERROR = "validation_error"
SERVER_ERROR = "server_error"
TRANSACTION_NOT_FOUND = "transaction_not_found"
GATEWAY_NOT_WORKING = "gateway_not_working"
TRANSACTION_ALREADY_PAYED = "transaction_already_payed"
CARD_IS_NOT_SUPPORTED = "card_is_not_supported"
PROCESSING_ERROR = "processing_error"
INVALID_CARD_TOKEN = "invalid_card_token"
TOO_MANY_ATTEMPTS = "too_many_attempts"
TERMINAL_DOES_NOT_EXIST = "terminal_does_not_exist"
CARD_IS_ALREADY_ACTIVATED = "card_is_already_activated"
FIELD_NOT_VALID = "field_not_valid"
BANK_NOT_FOUND = "bank_not_found"
MERCHANT_NOT_AVAILABLE = "merchant_not_available"
INVALID_AMOUNT = "invalid_amount"
TRANSACTION_NOT_AVAILABLE_FOR_PAYMENT = "transaction_not_available_for_payment"
ALREADY_CONFIRMED = "already_confirmed"
HOLD_NOT_FOUND = "hold_not_found"
INVALID_CARD = "invalid_card"
ERROR_AT_PAY = "error_at_pay"
PAN_NOT_VALID = "pan_not_valid"
ERROR_CARD_CREATE = "error_create_card"
CARD_IS_NOT_FOR_THIS_CHECK = "card_is_not_for_this_check"
TRANSACTION_NOT_AVAILABLE_FOR_CANCEL = "transaction_not_available_for_cancel"
CARD_NOT_ACTIVE = "card_not_active"
SERVICE_TEMPORARILY_NOT_ACCEPTING_PAYMENTS = 'service_temporarily_not_accepting_payments'
SPLIT_NOT_FOUND = 'split_not_found'
SPLIT_ALREADY_DONE = 'split_already_done'
RECEIPT_NOT_AVAILABLE_FOR_SPLIT = 'receipt_not_available_for_split'
EXTERNAL_ID_ALREADY_EXISTS = 'external_id_already_exists'
OTP_EXPIRED = 'otp_expired'
RECEIPT_NOT_AVAILABLE_FOR_OPERATION = 'receipt_not_available_for_operation'
OFD_CHECK_ALREADY_GENERATED = 'ofd_check_already_generated'
OFD_TOO_MANY_REQUESTS_FOR_THIS_RECEIPT = 'ofd_too_many_requests_for_this_receipt'    # if more that 10 req for a tr
HOLD_TIME_EXPIRED = "hold_time_expired"
SERVICE_PAYMENT_ERROR = "service_payment_error"
SERVICE_NOT_FOUND = "service_not_found"
CARD_IS_BLOCKED_IN_PROCESSING_CENTER = "card_is_blocked_in_processing_center"
CARD_NOT_FOUND_IN_PROCESSING_CENTER = "card_not_found_in_processing_center"
BALANCE_REFRESH_ERROR = 'balance_refresh_error'
CARD_HAS_NO_PHONE = 'card_has_no_phone'
DAILY_LIMIT_USED_FOR_THIS_CARD = 'daily_limit_used_for_this_card'      # card activation request limit
SMS_NOT_ACTIVE = 'sms_not_active'
RECEIVER_CARD_NOT_FOUND = 'receiver_card_not_found' 
RECEIVER_CARD_NOT_VALID = 'receiver_card_not_valid'
RECEIVER_CARD_BANK_NOT_FOUND = 'receiver_card_bank_not_found'      
SAME_CARDS = 'same_cards'
SERVICE_NOT_AVAILABLE = 'service_not_available'
SENDER_CARD_NOT_FOUND = 'sender_card_not_found'
SENDER_CARD_NOT_ACTIVE = 'sender_card_not_active'
CARD_NOT_MATCH = 'card_not_match'
CAN_NOT_TRANSFER_SAME_CARD = 'can_not_transfer_same_card'
PINFL_NOT_MATCH = 'pinfl_not_match'
```

## Notes (extraction)
- EN and RU error JSON includes // and # comments and is invalid JSON. UZ removes the comments from JSON and states the optional data field and its dict/string/null types in prose. UZ adds translated explanations to each error constant; the code values agree. EN/RU specify more than 10 OFD requests and card activation request limit in comments; UZ replaces these with generic descriptions without those details.
- Source JSON block is invalid JSON (Expecting ',' delimiter); preserved without correction.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -3,70 +3,68 @@
   "error": {
     "code": "invalid_card",
     "message": "invalid_card",
-		"data": {} // dict or string, Null
+    "data": {}
   }
 }
 
-# 'data' field might not be in error response
-
-UNKNOWN_ERROR = "unknown_error"
-INVALID_OTP = "invalid_otp"
-CARD_IS_BLOCKED = "card_is_blocked"
-CARD_EXISTS = "card_exists"
-CARD_NOT_FOUND = "card_not_found"
-CARD_EXPIRED = "card_expired"
-FIELD_REQUIRED = "field_required"
-INSUFFICIENT_FUNDS = "insufficient_funds"
-VALIDATION_ERROR = "validation_error"
-SERVER_ERROR = "server_error"
-TRANSACTION_NOT_FOUND = "transaction_not_found"
-GATEWAY_NOT_WORKING = "gateway_not_working"
-TRANSACTION_ALREADY_PAYED = "transaction_already_payed"
-CARD_IS_NOT_SUPPORTED = "card_is_not_supported"
-PROCESSING_ERROR = "processing_error"
-INVALID_CARD_TOKEN = "invalid_card_token"
-TOO_MANY_ATTEMPTS = "too_many_attempts"
-TERMINAL_DOES_NOT_EXIST = "terminal_does_not_exist"
-CARD_IS_ALREADY_ACTIVATED = "card_is_already_activated"
-FIELD_NOT_VALID = "field_not_valid"
-BANK_NOT_FOUND = "bank_not_found"
-MERCHANT_NOT_AVAILABLE = "merchant_not_available"
-INVALID_AMOUNT = "invalid_amount"
-TRANSACTION_NOT_AVAILABLE_FOR_PAYMENT = "transaction_not_available_for_payment"
-ALREADY_CONFIRMED = "already_confirmed"
-HOLD_NOT_FOUND = "hold_not_found"
-INVALID_CARD = "invalid_card"
-ERROR_AT_PAY = "error_at_pay"
-PAN_NOT_VALID = "pan_not_valid"
-ERROR_CARD_CREATE = "error_create_card"
-CARD_IS_NOT_FOR_THIS_CHECK = "card_is_not_for_this_check"
-TRANSACTION_NOT_AVAILABLE_FOR_CANCEL = "transaction_not_available_for_cancel"
-CARD_NOT_ACTIVE = "card_not_active"
-SERVICE_TEMPORARILY_NOT_ACCEPTING_PAYMENTS = 'service_temporarily_not_accepting_payments'
-SPLIT_NOT_FOUND = 'split_not_found'
-SPLIT_ALREADY_DONE = 'split_already_done'
-RECEIPT_NOT_AVAILABLE_FOR_SPLIT = 'receipt_not_available_for_split'
-EXTERNAL_ID_ALREADY_EXISTS = 'external_id_already_exists'
-OTP_EXPIRED = 'otp_expired'
-RECEIPT_NOT_AVAILABLE_FOR_OPERATION = 'receipt_not_available_for_operation'
-OFD_CHECK_ALREADY_GENERATED = 'ofd_check_already_generated'
-OFD_TOO_MANY_REQUESTS_FOR_THIS_RECEIPT = 'ofd_too_many_requests_for_this_receipt'    # if more that 10 req for a tr
-HOLD_TIME_EXPIRED = "hold_time_expired"
-SERVICE_PAYMENT_ERROR = "service_payment_error"
-SERVICE_NOT_FOUND = "service_not_found"
-CARD_IS_BLOCKED_IN_PROCESSING_CENTER = "card_is_blocked_in_processing_center"
-CARD_NOT_FOUND_IN_PROCESSING_CENTER = "card_not_found_in_processing_center"
-BALANCE_REFRESH_ERROR = 'balance_refresh_error'
-CARD_HAS_NO_PHONE = 'card_has_no_phone'
-DAILY_LIMIT_USED_FOR_THIS_CARD = 'daily_limit_used_for_this_card'      # card activation request limit
-SMS_NOT_ACTIVE = 'sms_not_active'
-RECEIVER_CARD_NOT_FOUND = 'receiver_card_not_found' 
-RECEIVER_CARD_NOT_VALID = 'receiver_card_not_valid'
-RECEIVER_CARD_BANK_NOT_FOUND = 'receiver_card_bank_not_found'      
-SAME_CARDS = 'same_cards'
-SERVICE_NOT_AVAILABLE = 'service_not_available'
-SENDER_CARD_NOT_FOUND = 'sender_card_not_found'
-SENDER_CARD_NOT_ACTIVE = 'sender_card_not_active'
-CARD_NOT_MATCH = 'card_not_match'
-CAN_NOT_TRANSFER_SAME_CARD = 'can_not_transfer_same_card'
-PINFL_NOT_MATCH = 'pinfl_not_match'
+UNKNOWN_ERROR = "unknown_error"  # noma’lum xatolik
+INVALID_OTP = "invalid_otp"  # noto‘g‘ri OTP
+CARD_IS_BLOCKED = "card_is_blocked"  # karta bloklangan
+CARD_EXISTS = "card_exists"  # karta allaqachon mavjud
+CARD_NOT_FOUND = "card_not_found"  # karta topilmadi
+CARD_EXPIRED = "card_expired"  # karta muddati tugagan
+FIELD_REQUIRED = "field_required"  # majburiy maydon yuborilmagan
+INSUFFICIENT_FUNDS = "insufficient_funds"  # mablag‘ yetarli emas
+VALIDATION_ERROR = "validation_error"  # validatsiya xatosi
+SERVER_ERROR = "server_error"  # server xatoligi
+TRANSACTION_NOT_FOUND = "transaction_not_found"  # tranzaksiya topilmadi
+GATEWAY_NOT_WORKING = "gateway_not_working"  # gateway ishlamayapti
+TRANSACTION_ALREADY_PAYED = "transaction_already_payed"  # tranzaksiya allaqachon to‘langan
+CARD_IS_NOT_SUPPORTED = "card_is_not_supported"  # karta qo‘llab-quvvatlanmaydi
+PROCESSING_ERROR = "processing_error"  # processing jarayonida xatolik
+INVALID_CARD_TOKEN = "invalid_card_token"  # noto‘g‘ri karta tokeni
+TOO_MANY_ATTEMPTS = "too_many_attempts"  # urinishlar soni juda ko‘p
+TERMINAL_DOES_NOT_EXIST = "terminal_does_not_exist"  # terminal mavjud emas
+CARD_IS_ALREADY_ACTIVATED = "card_is_already_activated"  # karta allaqachon aktivlashtirilgan
+FIELD_NOT_VALID = "field_not_valid"  # maydon qiymati noto‘g‘ri
+BANK_NOT_FOUND = "bank_not_found"  # bank topilmadi
+MERCHANT_NOT_AVAILABLE = "merchant_not_available"  # merchant mavjud emas yoki faol emas
+INVALID_AMOUNT = "invalid_amount"  # summa noto‘g‘ri
+TRANSACTION_NOT_AVAILABLE_FOR_PAYMENT = "transaction_not_available_for_payment"  # tranzaksiya to‘lov uchun mavjud emas
+ALREADY_CONFIRMED = "already_confirmed"  # allaqachon tasdiqlangan
+HOLD_NOT_FOUND = "hold_not_found"  # hold topilmadi
+INVALID_CARD = "invalid_card"  # noto‘g‘ri karta
+ERROR_AT_PAY = "error_at_pay"  # to‘lov vaqtida xatolik
+PAN_NOT_VALID = "pan_not_valid"  # PAN noto‘g‘ri
+ERROR_CARD_CREATE = "error_create_card"  # karta yaratishda xatolik
+CARD_IS_NOT_FOR_THIS_CHECK = "card_is_not_for_this_check"  # karta ushbu tekshiruv uchun mos emas
+TRANSACTION_NOT_AVAILABLE_FOR_CANCEL = "transaction_not_available_for_cancel"  # tranzaksiya bekor qilish uchun mavjud emas
+CARD_NOT_ACTIVE = "card_not_active"  # karta faol emas
+SERVICE_TEMPORARILY_NOT_ACCEPTING_PAYMENTS = "service_temporarily_not_accepting_payments"  # xizmat vaqtincha to‘lov qabul qilmayapti
+SPLIT_NOT_FOUND = "split_not_found"  # split ma’lumoti topilmadi
+SPLIT_ALREADY_DONE = "split_already_done"  # split allaqachon bajarilgan
+RECEIPT_NOT_AVAILABLE_FOR_SPLIT = "receipt_not_available_for_split"  # receipt split uchun mavjud emas
+EXTERNAL_ID_ALREADY_EXISTS = "external_id_already_exists"  # external_id allaqachon mavjud
+OTP_EXPIRED = "otp_expired"  # OTP muddati tugagan
+RECEIPT_NOT_AVAILABLE_FOR_OPERATION = "receipt_not_available_for_operation"  # receipt ushbu amal uchun mavjud emas
+OFD_CHECK_ALREADY_GENERATED = "ofd_check_already_generated"  # OFD cheki allaqachon yaratilgan
+OFD_TOO_MANY_REQUESTS_FOR_THIS_RECEIPT = "ofd_too_many_requests_for_this_receipt"  # ushbu receipt uchun OFD so‘rovlari soni juda ko‘p
+HOLD_TIME_EXPIRED = "hold_time_expired"  # hold muddati tugagan
+SERVICE_PAYMENT_ERROR = "service_payment_error"  # service payment xatoligi
+SERVICE_NOT_FOUND = "service_not_found"  # xizmat topilmadi
+CARD_IS_BLOCKED_IN_PROCESSING_CENTER = "card_is_blocked_in_processing_center"  # karta processing markazida bloklangan
+CARD_NOT_FOUND_IN_PROCESSING_CENTER = "card_not_found_in_processing_center"  # karta processing markazida topilmadi
+BALANCE_REFRESH_ERROR = "balance_refresh_error"  # balansni yangilashda xatolik
+CARD_HAS_NO_PHONE = "card_has_no_phone"  # karta uchun telefon raqami biriktirilmagan
+DAILY_LIMIT_USED_FOR_THIS_CARD = "daily_limit_used_for_this_card"  # ushbu karta bo‘yicha kunlik limit ishlatib bo‘lingan
+SMS_NOT_ACTIVE = "sms_not_active"  # SMS xizmati faol emas
+RECEIVER_CARD_NOT_FOUND = "receiver_card_not_found"  # qabul qiluvchi karta topilmadi
+RECEIVER_CARD_NOT_VALID = "receiver_card_not_valid"  # qabul qiluvchi karta noto‘g‘ri
+RECEIVER_CARD_BANK_NOT_FOUND = "receiver_card_bank_not_found"  # qabul qiluvchi karta banki topilmadi
+SAME_CARDS = "same_cards"  # bir xil kartalar
+SERVICE_NOT_AVAILABLE = "service_not_available"  # xizmat mavjud emas
+SENDER_CARD_NOT_FOUND = "sender_card_not_found"  # yuboruvchi karta topilmadi
+SENDER_CARD_NOT_ACTIVE = "sender_card_not_active"  # yuboruvchi karta faol emas
+CARD_NOT_MATCH = "card_not_match"  # karta mos kelmadi
+CAN_NOT_TRANSFER_SAME_CARD = "can_not_transfer_same_card"  # bir xil kartaga o‘tkazma qilib bo‘lmaydi
+PINFL_NOT_MATCH = "pinfl_not_match"  # PINFL mos kelmadi
```
