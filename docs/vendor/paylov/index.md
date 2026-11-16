---
source_url: https://developer.paylov.uz/
---

# Paylov API

Payments infrastructure for developers

Build checkout, recurring payments and fiscalization flows with a clear path from your first credential to production.

[Start integration →](https://developer.paylov.uz/integration-overview)

[Explore Checkout API](https://developer.paylov.uz/merchants/paylov-payment-gateway)

API Keys

Sandbox

consumer_key app_a1b2c3••••

consumer_secret Ks8Lp90q••••

POST /oauth2/token/ 200

POST /payment/ 200

GET /card/ 401

Transaction

amount 150 000 UZS

status success

time 2025-05-14 13:42

💳

## Checkout API

Accept online payments with hosted checkout, payment links and callback validation.

[Learn more](https://developer.paylov.uz/merchants/paylov-payment-gateway)

🔄

## Subscribe API

Manage saved cards, recurring payments, P2P transfers and hold payments.

[Learn more](https://developer.paylov.uz/subscribe/authorization)

🏦

## Account2Card

Transfer funds from a merchant account to a card and track each transaction.

[Learn more](https://developer.paylov.uz/a2c/perform-transaction)

📊

## Card Monitoring

Review a customer card's transaction history and monitor card activity.

[Learn more](https://developer.paylov.uz/subscribe/card-monitoring)

🧾

## Service Payment (PSP Communal)

Discover utility services, prepare required fields and process service payments.

[Learn more](https://developer.paylov.uz/subscribe/service-payment)

🔀

## Split Payment

Divide one payment between multiple recipients and track its status.

[Learn more](https://developer.paylov.uz/subscribe/split-payment)

INTEGRATION PATH

## From credentials to a live payment

Follow the shortest reliable route to your first Paylov integration.

- [01Configuration**Set up your merchant**Get the credentials and callback details your integration needs.↗](https://developer.paylov.uz/integration-overview)

- [02Authentication**Authenticate requests**Create credentials and obtain an access token securely.↗](https://developer.paylov.uz/subscribe/authorization)

- [03User Card**Add a customer card**Create and confirm a reusable card for your customer.↗](https://developer.paylov.uz/subscribe/create-user-card)

- [04Payment**Create a payment**Create, confirm and track a Subscribe API payment.↗](https://developer.paylov.uz/subscribe/payment/)

[✓**Before accepting payments**Review card confirmation, payment statuses and Subscribe API errors.Review payment status →](https://developer.paylov.uz/subscribe/payment/transaction-status)

## Notes (extraction)

- The homepage displays masked credential-like samples consumer_key and consumer_secret; these are public vendor text. The sample transaction is 150 000 UZS, success, 2025-05-14 13:42.
- EN, RU and UZ agree on factual API content, fields, types, required flags, units, codes and example values; prose is localized.
- Page link targets by language (including localized navigation within the content): EN: `https://developer.paylov.uz/integration-overview`, `https://developer.paylov.uz/merchants/paylov-payment-gateway`, `https://developer.paylov.uz/merchants/paylov-payment-gateway`, `https://developer.paylov.uz/subscribe/authorization`, `https://developer.paylov.uz/a2c/perform-transaction`, `https://developer.paylov.uz/subscribe/card-monitoring`, `https://developer.paylov.uz/subscribe/service-payment`, `https://developer.paylov.uz/subscribe/split-payment`, `https://developer.paylov.uz/integration-overview`, `https://developer.paylov.uz/subscribe/authorization`, `https://developer.paylov.uz/subscribe/create-user-card`, `https://developer.paylov.uz/subscribe/payment/`, `https://developer.paylov.uz/subscribe/payment/transaction-status`; RU: `https://developer.paylov.uz/ru/integration-overview`, `https://developer.paylov.uz/ru/merchants/paylov-payment-gateway`, `https://developer.paylov.uz/ru/merchants/paylov-payment-gateway`, `https://developer.paylov.uz/ru/subscribe/authorization`, `https://developer.paylov.uz/ru/a2c/perform-transaction`, `https://developer.paylov.uz/ru/subscribe/card-monitoring`, `https://developer.paylov.uz/ru/subscribe/service-payment`, `https://developer.paylov.uz/ru/subscribe/split-payment`, `https://developer.paylov.uz/ru/integration-overview`, `https://developer.paylov.uz/ru/subscribe/authorization`, `https://developer.paylov.uz/ru/subscribe/create-user-card`, `https://developer.paylov.uz/ru/subscribe/payment/`, `https://developer.paylov.uz/ru/subscribe/payment/transaction-status`; UZ: `https://developer.paylov.uz/uz/integration-overview`, `https://developer.paylov.uz/uz/merchants/paylov-payment-gateway`, `https://developer.paylov.uz/uz/merchants/paylov-payment-gateway`, `https://developer.paylov.uz/uz/subscribe/authorization`, `https://developer.paylov.uz/uz/a2c/perform-transaction`, `https://developer.paylov.uz/uz/subscribe/card-monitoring`, `https://developer.paylov.uz/uz/subscribe/service-payment`, `https://developer.paylov.uz/uz/subscribe/split-payment`, `https://developer.paylov.uz/uz/integration-overview`, `https://developer.paylov.uz/uz/subscribe/authorization`, `https://developer.paylov.uz/uz/subscribe/create-user-card`, `https://developer.paylov.uz/uz/subscribe/payment/`, `https://developer.paylov.uz/uz/subscribe/payment/transaction-status`.
