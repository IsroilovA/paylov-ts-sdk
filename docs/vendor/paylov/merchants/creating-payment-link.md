---
source_url: https://developer.paylov.uz/merchants/creating-payment-link
---

# Creating payment link

| Name | Type | Description | Required |
| --- | --- | --- | --- |
| merchant_id | UUID4 | Merchant ID | Yes |
| account | Account | Service user account | Yes |
| amount | Amount | Payment amount | Yes |
| amount_in_tiyin | Bool (True/False) | Defines whether the amount field is in tiyin (penny) or not. | No (if not included, defaults to False) |
| currency_id | int | 860 - UZS \| 840 - USD | No (if not included, defaults to 860 UZS) |
| convert_to | int | 860 - UZS \| 840 - USD | No |

If the amount is in tiyin (pennies), it should be multiplied by 100 (e.g., 100 UZS → 10000 tiyin) and must have no more than two digits at the end. If not in tiyin, use the standard amount (e.g., 100 UZS → 100).

**Field: convert_to**

If provided, the transaction will be generated in the specified currency (SUM or USD). The payment amount will be converted according to the **current exchange rate of the Central Bank of Uzbekistan** at the time of transaction generation.

## Creating URL example

- Create query: merchant_id=571c06fb-6c61-4ef7-8567-5511abaf12b5&amount=500&account.order_id=12&return_url=[https://returnurl](https://returnurl)

- Encode query to bas64 format: bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==

- Combine encoded query with base URL ([https://my.paylov.uz/checkout/create/{query}](https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9JmFtb3VudD0xMjAwLjAwJmFjY291bnQub3JkZXJfaWQ9MTE1)) [https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==](https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==)

Query Params for UZS payments

```json
query_params = {
        "merchant_id": merchant_id,
        "amount": amount,
        "return_url": return_url
    }
```

Query Params for Visa/Master USD payments

```json
query_params = {
        "merchant_id": merchant_id,
        "amount": amount,
        "return_url": return_url,
        "amount_in_tiyin": True,
        "currency_id": 840
    }
```

sample python code to generate payment

```python
import base64
import urllib.parse


def generate_payment_link(base_url, merchant_id, amount, account_params, return_url):
    # Create query string
    query_params = {
        "merchant_id": merchant_id,
        "amount": amount,
        "return_url": return_url
    }

    # Add account-related fields
    for key, value in account_params.items():
        query_params[f"account.{key}"] = value

    query_string = urllib.parse.urlencode(query_params)

    # Encode query string to Base64
    encoded_query = base64.b64encode(query_string.encode()).decode()

    # Combine with base URL
    payment_link = f"{base_url}{encoded_query}"

    return payment_link


# Example usage
base_url = "https://my.paylov.uz/checkout/create/"
merchant_id = "0das467e-82sf-42df-8642-g51aawy5ga2r"
amount = "500"
account_params = {"order_id": "1233"}
return_url = "https://returnurl"

payment_link = generate_payment_link(base_url, merchant_id, amount, account_params, return_url)
print(payment_link)
```

## Notes (extraction)

- Source typo "bas64" is preserved. The prose query contains return_url but the displayed base64 omits it. The link labelled https://my.paylov.uz/checkout/create/{query} targets a different encoded example (empty merchant_id, amount=1200.00, account.order_id=115). The Python merchant_id example is not a valid UUID4. The two blocks declared json are Python assignments, not JSON. The wording "must have no more than two digits at the end" is preserved.
- RU renders currency_id and convert_to with Description “860 - UZS” followed by two literal backslashes and Required “840 - USD”, omitting the EN/UZ Required values (currency_id optional with default 860 UZS; convert_to optional). UZ omits the separate placeholder-labelled checkout URL link and its different encoded target. UZ translates four Python comments; executable code agrees.
- Example block 3, EN versus UZ (including formatting/comment differences):

```diff
--- EN
+++ UZ
@@ -3,23 +3,23 @@
 
 
 def generate_payment_link(base_url, merchant_id, amount, account_params, return_url):
-    # Create query string
+    # Query string yaratish
     query_params = {
         "merchant_id": merchant_id,
         "amount": amount,
         "return_url": return_url
     }
 
-    # Add account-related fields
+    # Account bilan bog‘liq fieldlarni qo‘shish
     for key, value in account_params.items():
         query_params[f"account.{key}"] = value
 
     query_string = urllib.parse.urlencode(query_params)
 
-    # Encode query string to Base64
+    # Query string’ni Base64 formatga encode qilish
     encoded_query = base64.b64encode(query_string.encode()).decode()
 
-    # Combine with base URL
+    # Base URL bilan birlashtirish
     payment_link = f"{base_url}{encoded_query}"
 
     return payment_link
```
- Page link targets by language (including localized navigation within the content): EN: `https://returnurl`, `https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9JmFtb3VudD0xMjAwLjAwJmFjY291bnQub3JkZXJfaWQ9MTE1`, `https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==`; RU: `https://returnurl`, `https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9JmFtb3VudD0xMjAwLjAwJmFjY291bnQub3JkZXJfaWQ9MTE1`, `https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==`; UZ: .
