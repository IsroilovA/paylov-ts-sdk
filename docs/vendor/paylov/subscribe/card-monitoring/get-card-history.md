---
source_url: https://developer.paylov.uz/subscribe/card-monitoring/get-card-history
---

# Get Card History

To get Card Monitoring, merchants must follow these steps:

1. Create a Card in the Paylov System. *(Docs available [here](https://developer.paylov.uz/subscribe/create-user-card.html))*

2. Send a request to the `getCardHistory` service.

### Endpoint details

> **Method:** `GET`<br>**URL:** BASE_URL/`merchant/getCardHistory/`<br>**Header:**

```http
Authorization: Bearer <ACCESS_TOKEN>
```

> **Query:**

| Query | sample_data | Type | Required | Description |
| --- | --- | --- | --- | --- |
| cardId | 9f877739-bc25-4f0f-a13f-ec485fd04250 | string | Yes | cardId created in Paylov system |
| from_date | 2024-04-18 | string | No | starting date |
| to_date | 2024-06-15 | string | No | ending date |

## Request example

```plaintext
BASE_URL/merchant/getCardHistory/?cardId=9f877739-bc25-4f0f-a13f-ec485fd04250
```

## Example request with from_date and to_date

```plaintext
 BASE_URL/merchant/getCardHistory/?cardId=9f877739-bc25-4f0f-a13f-ec485fd04250&from_date=2024-12-01&to_date=2025-03-01
```

## Response Example

The response structure for **HUMO** and **UZCARD** is the same but differs in fields

## Response body

```json
{
  "result": {
    "processing": "string",
    "data": [
      {
        "additionalProp1": "string",
        "additionalProp2": "string",
        "additionalProp3": "string"
      }
    ]
  }
}
```

## HUMO Card Response

```json
{
    "result": {
        "processing": "humo",
        "data": [
            {
                "CARD_ACCT": "34011760001111111",
                "ACCOUNT_NO": "211111111",
                "CL_ACCT_KEY": "212221221",
                "CLIENT": "01111111",
                "CARD": "9860000000000000",
                "EXP_DATE": null,
                "TRAN_TYPE": "110",
                "TRAN_CCY": "UZS",
                "TRAN_AMT": "555000000",
                "CCY_EXP": "2",
                "TRAN_DATE_TIME": "2024-03-28T00:00:00",
                "REC_DATE": "2024-03-28T00:00:00",
                "POST_DATE": "2024-03-28T00:00:00",
                "ACCNT_CCY": "UZS",
                "AMOUNT_NET": "855000000",
                "ACQREF_NR": null,
                "APR_CODE": "000000",
                "APR_SCR": null,
                "STAN": null,
                "TERM_ID": null,
                "MERCHANT": null,
                "POINT_CODE": null,
                "MCC_CODE": null,
                "ABVR_NAME": null,
                "CITY": null,
                "COUNTRY": null,
                "DEAL_DESC": "#ASBT79311111#",
                "COUNTERPARTY": null,
                "INTERNAL_NO": "3840111111",
                "FLD_104": null,
                "BANK_C": "34",
                "GROUPC": "01",
                "CTIME": "2024-03-28T16:29:50",
                "TR_CODE": null,
                "TR_FEE": null,
                "TR_CODE2": null,
                "TR_FEE2": null,
                "LOCKING_FLAG": null,
                "ADD_INFO": "API_ONLINE_PAYMENT",
                "REF_NUMBER": null
            }
              ]
         }
    }
```

## UZCARD Response

```json
{
    "result": {
        "processing": "uzcard",
        "data": [
            {
                "utrnno": 21588011111,
                "transType": "785",
                "hpan": "860003******3511",
                "utime": 143554,
                "udate": 20240701,
                "bankDate": null,
                "reqamt": 3500000,
                "resp": -1,
                "reversal": false,
                "orgdev": 997412,
                "merchant": "901335111",
                "terminal": "92000111",
                "merchantName": "TOSHKENT SH., ASAKA AT BANKINING BOSH",
                "street": "Toshkent shakhar Nukus kuchasi ",
                "city": "Toshkent shakhar",
                "isCredit": true,
                "credit": true,
                "mcc": 5999,
                "currency": 860,
                "actamt": 3500000,
                "acctbal": 8479000,
                "conamt": 3500000
            }
              ]
         }
 }
```

## Notes (extraction)
- Public example includes full card number 9860000000000000 and account identifiers. UZ accidentally includes literal Markdown heading/fence text “## HUMO Card Response” and “```json” inside its response code block; EN/RU render the HUMO response separately. Values and fields in the HUMO/UZCARD examples otherwise agree.
- Complete literal code/example differences for UZ (including whitespace and translated comments):

````diff
--- EN code blocks
+++ UZ code blocks
@@ -2,7 +2,7 @@
 
 BASE_URL/merchant/getCardHistory/?cardId=9f877739-bc25-4f0f-a13f-ec485fd04250
 
- BASE_URL/merchant/getCardHistory/?cardId=9f877739-bc25-4f0f-a13f-ec485fd04250&from_date=2024-12-01&to_date=2025-03-01
+BASE_URL/merchant/getCardHistory/?cardId=9f877739-bc25-4f0f-a13f-ec485fd04250&from_date=2024-12-01&to_date=2025-03-01
 
 {
   "result": {
@@ -17,84 +17,88 @@
   }
 }
 
+
+## HUMO Card Response
+
+```json
 {
-    "result": {
-        "processing": "humo",
-        "data": [
-            {
-                "CARD_ACCT": "34011760001111111",
-                "ACCOUNT_NO": "211111111",
-                "CL_ACCT_KEY": "212221221",
-                "CLIENT": "01111111",
-                "CARD": "9860000000000000",
-                "EXP_DATE": null,
-                "TRAN_TYPE": "110",
-                "TRAN_CCY": "UZS",
-                "TRAN_AMT": "555000000",
-                "CCY_EXP": "2",
-                "TRAN_DATE_TIME": "2024-03-28T00:00:00",
-                "REC_DATE": "2024-03-28T00:00:00",
-                "POST_DATE": "2024-03-28T00:00:00",
-                "ACCNT_CCY": "UZS",
-                "AMOUNT_NET": "855000000",
-                "ACQREF_NR": null,
-                "APR_CODE": "000000",
-                "APR_SCR": null,
-                "STAN": null,
-                "TERM_ID": null,
-                "MERCHANT": null,
-                "POINT_CODE": null,
-                "MCC_CODE": null,
-                "ABVR_NAME": null,
-                "CITY": null,
-                "COUNTRY": null,
-                "DEAL_DESC": "#ASBT79311111#",
-                "COUNTERPARTY": null,
-                "INTERNAL_NO": "3840111111",
-                "FLD_104": null,
-                "BANK_C": "34",
-                "GROUPC": "01",
-                "CTIME": "2024-03-28T16:29:50",
-                "TR_CODE": null,
-                "TR_FEE": null,
-                "TR_CODE2": null,
-                "TR_FEE2": null,
-                "LOCKING_FLAG": null,
-                "ADD_INFO": "API_ONLINE_PAYMENT",
-                "REF_NUMBER": null
-            }
-              ]
-         }
-    }
+  "result": {
+    "processing": "humo",
+    "data": [
+      {
+        "CARD_ACCT": "34011760001111111",
+        "ACCOUNT_NO": "211111111",
+        "CL_ACCT_KEY": "212221221",
+        "CLIENT": "01111111",
+        "CARD": "9860000000000000",
+        "EXP_DATE": null,
+        "TRAN_TYPE": "110",
+        "TRAN_CCY": "UZS",
+        "TRAN_AMT": "555000000",
+        "CCY_EXP": "2",
+        "TRAN_DATE_TIME": "2024-03-28T00:00:00",
+        "REC_DATE": "2024-03-28T00:00:00",
+        "POST_DATE": "2024-03-28T00:00:00",
+        "ACCNT_CCY": "UZS",
+        "AMOUNT_NET": "855000000",
+        "ACQREF_NR": null,
+        "APR_CODE": "000000",
+        "APR_SCR": null,
+        "STAN": null,
+        "TERM_ID": null,
+        "MERCHANT": null,
+        "POINT_CODE": null,
+        "MCC_CODE": null,
+        "ABVR_NAME": null,
+        "CITY": null,
+        "COUNTRY": null,
+        "DEAL_DESC": "#ASBT79311111#",
+        "COUNTERPARTY": null,
+        "INTERNAL_NO": "3840111111",
+        "FLD_104": null,
+        "BANK_C": "34",
+        "GROUPC": "01",
+        "CTIME": "2024-03-28T16:29:50",
+        "TR_CODE": null,
+        "TR_FEE": null,
+        "TR_CODE2": null,
+        "TR_FEE2": null,
+        "LOCKING_FLAG": null,
+        "ADD_INFO": "API_ONLINE_PAYMENT",
+        "REF_NUMBER": null
+      }
+    ]
+  }
+}
 
 {
-    "result": {
-        "processing": "uzcard",
-        "data": [
-            {
-                "utrnno": 21588011111,
-                "transType": "785",
-                "hpan": "860003******3511",
-                "utime": 143554,
-                "udate": 20240701,
-                "bankDate": null,
-                "reqamt": 3500000,
-                "resp": -1,
-                "reversal": false,
-                "orgdev": 997412,
-                "merchant": "901335111",
-                "terminal": "92000111",
-                "merchantName": "TOSHKENT SH., ASAKA AT BANKINING BOSH",
-                "street": "Toshkent shakhar Nukus kuchasi ",
-                "city": "Toshkent shakhar",
-                "isCredit": true,
-                "credit": true,
-                "mcc": 5999,
-                "currency": 860,
-                "actamt": 3500000,
-                "acctbal": 8479000,
-                "conamt": 3500000
-            }
-              ]
-         }
- }
+  "result": {
+    "processing": "uzcard",
+    "data": [
+      {
+        "utrnno": 21588011111,
+        "transType": "785",
+        "hpan": "860003******3511",
+        "utime": 143554,
+        "udate": 20240701,
+        "bankDate": null,
+        "reqamt": 3500000,
+        "resp": -1,
+        "reversal": false,
+        "orgdev": 997412,
+        "merchant": "901335111",
+        "terminal": "92000111",
+        "merchantName": "TOSHKENT SH., ASAKA AT BANKINING BOSH",
+        "street": "Toshkent shakhar Nukus kuchasi ",
+        "city": "Toshkent shakhar",
+        "isCredit": true,
+        "credit": true,
+        "mcc": 5999,
+        "currency": 860,
+        "actamt": 3500000,
+        "acctbal": 8479000,
+        "conamt": 3500000
+      }
+    ]
+  }
+}
````
- Public source contains full-length card-number-like values: 9860000000000000. Preserved as published.
