---
source_url: https://developer.paylov.uz/a2c.html
---

# Account2Card

Account2Card is documented as separate operations:

- [Perform transaction](https://developer.paylov.uz/a2c/perform-transaction)
- [Check transaction status](https://developer.paylov.uz/a2c/transaction-status)
- [Check status by external ID](https://developer.paylov.uz/a2c/status-by-external-id)
- [Get account balance](https://developer.paylov.uz/a2c/balance)

## Statuses

- success
- in_progress
- failed

## Notes (extraction)
- The page is not linked from the site navigation. The requested EN, RU and UZ trailing-slash URLs each return HTTP 403; the corresponding `.html` URLs return HTTP 200 with the index content extracted here. The index lists four operations and omits the deposit-webhook operation present in the site sidebar. No images occur in the content.
- EN, RU and UZ agree on all four operations and the statuses success, in_progress, failed. RU operation URLs prepend /ru to the EN paths; UZ URLs prepend /uz. Only explanatory prose, link labels, and the Statuses heading are translated.
