# @isroilov_an/paylov

Unofficial server-side TypeScript SDK for the [Paylov](https://paylov.uz) payment gateway
(Uzbekistan). Node 24.13.1+, ESM only, zero runtime dependencies.

> **Not affiliated with Paylov.** This is an independent project. It is not connected to, affiliated
> with, endorsed by, or sponsored by Paylov or its team. "Paylov" is a trademark of its owner and is
> used here only to name the service this SDK integrates with.

## Features

- Card binding through hosted Card Bind or card number and OTP; saved-card and one-off payments;
  full refunds.
- Holds with single capture or release, splits to sub-merchants, and OFD fiscal receipts.
- Transaction reconciliation, hosted checkout links, and authenticated webhook decoding with typed
  responses.
- Integer tiyin money, typed errors with recovery guidance for ambiguous failures, GET-only retries,
  and metadata-only logging that never records credentials or card data.
- A `@isroilov_an/paylov/testing` entry point with an in-memory gateway for application tests,
  scripted per call or simulating the gateway state Paylov has shown.

## Install

```sh
npm install @isroilov_an/paylov
```

Paylov issues the API credentials and allowlists the networks that may call the gateway; see
[Setup](docs/usage/setup.md).

## Quickstart

```ts
import { PaylovClient } from '@isroilov_an/paylov';

const paylov = new PaylovClient({
  baseUrl: 'https://dev.gw.paylov.uz',
  consumerKey: paylovConsumerKey,
  consumerSecret: paylovConsumerSecret,
  username: paylovUsername,
  password: paylovPassword,
});

const transaction = await paylov.transactions.get({ transactionId });
if (transaction?.status === 'paid') await orders.markPaid(orderId);

await paylov.close();
```

`baseUrl` is the bare gateway origin: `https://dev.gw.paylov.uz` for development,
`https://gw2.paylov.uz` for production.

## Documentation

The guides ship in the package under `docs/usage/`. Method contracts are in the JSDoc.

- [Usage index](docs/usage/INDEX.md): every export and method, and the guide that explains it.
- [Setup](docs/usage/setup.md): requirements, hosts, client lifecycle and a sandbox check.
- [Errors](docs/usage/errors.md): branching on failures and recovery after an ambiguous one.
- [Webhooks](docs/usage/webhooks.md): receiving and answering Paylov callbacks.
- [Testing](docs/usage/testing.md): the in-memory gateway and webhook requests.
- [Examples](https://github.com/IsroilovA/paylov-ts-sdk/tree/main/examples): runnable checkout and
  hold-capture flows.

Paylov's own references: the [sandbox](https://sandbox.paylov.uz/) and the
[developer docs](https://developer.paylov.uz/).

## Status

Pre-1.0: any release may contain breaking changes, listed in the [changelog](CHANGELOG.md). Where
Paylov leaves behavior undocumented, the SDK does not guess.

## Contributing

Development happens in the [GitHub repository](https://github.com/IsroilovA/paylov-ts-sdk). Report
vulnerabilities privately as described in the
[security policy](https://github.com/IsroilovA/paylov-ts-sdk/blob/main/SECURITY.md).

## License

[MIT](LICENSE)
