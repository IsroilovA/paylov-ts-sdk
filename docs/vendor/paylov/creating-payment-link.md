---
source_url: https://developer.paylov.uz/creating-payment-link
---

# Creating payment link

| Name | Type | Description | Required |
| --- | --- | --- | --- |
| merchant_id | UUID4 | Merchant ID | Yes |
| account | Account | Service user account | Yes |
| amount | Amount | Payment amount | Yes |
| amount_in_tiyin | Bool (True/False) | Defines whether the amount field is in tiyin (penny) or not. | No (if not included, defaults to False) |
| currency_id | int | 860 - UZS \| 840 - USD | No (if not included, defaults to 860 UZS) |

> If the amount is in tiyin (pennies), it should be multiplied by 100 (e.g., 100 UZS → 10000 tiyin) and must have no more than two digits at the end. If not in tiyin, use the standard amount (e.g., 100 UZS → 100).

## Creating URL example

1. Create query: merchant_id=571c06fb-6c61-4ef7-8567-5511abaf12b5&amount=500&account.order_id=12&return_url=[https://returnurl](https://returnurl)
2. Encode query to bas64 format: bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==
3. Combine encoded query with base URL ([https://my.paylov.uz/checkout/create/](https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9JmFtb3VudD0xMjAwLjAwJmFjY291bnQub3JkZXJfaWQ9MTE1)) [https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==](https://my.paylov.uz/checkout/create/bWVyY2hhbnRfaWQ9NTcxYzA2ZmItNmM2MS00ZWY3LTg1NjctNTUxMWFiYWYxMmI1JmFtb3VudD01MDAmYWNjb3VudC5vcmRlcl9pZD0xMg==)

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
- The page is not linked from the site navigation. No images occur in the content. Preserved source issues: “bas64” typo; the step-1 query includes return_url but the step-2 Base64 value decodes to the query without return_url; the link labeled https://my.paylov.uz/checkout/create/ actually targets a different encoded example (merchant_id=&amount=1200.00&account.order_id=115). The table omits return_url although the examples use it. The json-labelled examples contain Python assignments, unquoted variables, and True, so are invalid JSON. The Python example merchant_id is not a valid UUID4. The tiyin explanation says “must have no more than two digits at the end” without clarifying its meaning. No duplicated table rows were found.
- EN and UZ agree on all fields, types, required flags, currency codes, defaults, amounts, and example values. RU has a malformed currency_id row: its Description is “860 - UZS” followed by two literal backslashes and its Required cell is “840 - USD”; it loses the EN/UZ optional flag and default 860 UZS. EN and RU have identical JSON-labelled and Python code text. UZ removes their leading blank lines, uses two-space indentation in the JSON-labelled snippets, translates Python comments (except “# Example usage”), promotes the three example labels to level-2 headings, and uses inline code for the URL steps. UZ spells base64 correctly and omits the separately labeled base-URL hyperlink with its mismatched destination, giving the final combined URL directly. All three retain the same step-1/step-2 return_url omission. All three requested URLs return HTTP 200.
