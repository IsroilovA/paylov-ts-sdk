/** Offline client, webhook and testing-entry integration; also run from the packed package. */

import {
  PaylovClient,
  PaylovWebhookReceiver,
  createWebhookResponse,
  formatSum,
  isPaylovError,
  sumToTiyin,
  type FetchLike,
} from '../src/index.js';
import { PaylovFakeGateway, createWebhookRequest } from '../src/testing.js';

function check(condition: boolean, failure: string): void {
  if (!condition) throw new Error(failure);
}

async function rejectionOf(action: () => unknown): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

const fetchMock: FetchLike = () => {
  throw new Error('a client that never authenticated must not call the gateway');
};

const client = new PaylovClient({
  baseUrl: 'https://gateway.example',
  consumerKey: 'EXAMPLE-KEY',
  consumerSecret: 'EXAMPLE-SECRET',
  username: 'EXAMPLE-USER',
  password: 'EXAMPLE-PASSWORD',
  fetch: fetchMock,
});
await client.close();
check(formatSum(12345) === '123.45', 'money export failed');
check(sumToTiyin('123.45') === 12345, 'money export failed');

const configError = await rejectionOf(
  () =>
    new PaylovClient({
      baseUrl: 'http://gateway.example',
      consumerKey: 'EXAMPLE-KEY',
      consumerSecret: 'EXAMPLE-SECRET',
      username: 'EXAMPLE-USER',
      password: 'EXAMPLE-PASSWORD',
    }),
);
check(
  isPaylovError(configError) && configError.code === 'sdk_config_error',
  'config validation lost',
);

const login = 'EXAMPLE-CALLBACK-LOGIN';
const password = 'EXAMPLE-CALLBACK-PASSWORD';
const receiver = new PaylovWebhookReceiver({ login, password });
const event = receiver.receive({
  method: 'POST',
  headers: { authorization: 'Basic ' + btoa(login + ':' + password) },
  body: {
    jsonrpc: '2.0',
    id: 1234567,
    method: 'transaction.check',
    params: { account: { order_id: 12 }, amount: 500, amount_tiyin: 50000, currency: 860 },
  },
});
if (event.kind !== 'transaction.check') throw new Error('webhook integration failed');
const amountMatches = event.amount.currency === 860 && event.amount.amountTiyin === 50000;
const response = createWebhookResponse(event, amountMatches ? 'accept' : 'invalid_amount');
check(response.result.status === '0' && response.id === 1234567, 'webhook integration failed');

const fake = new PaylovFakeGateway();
const faked = new PaylovClient(fake.clientConfig);
fake.payments.create.reply({ transactionId: '00000000-0000-4000-8000-000000000001' });
fake.payments.pay.fail('insufficient_funds');
const { transactionId } = await faked.payments.create({ amountTiyin: 100_000, account: {} });
const declined = await rejectionOf(() =>
  faked.payments.pay({ transactionId, cardId: transactionId, userId: 'user-1' }),
);
check(isPaylovError(declined) && declined.code === 'insufficient_funds', 'testing entry failed');
await faked.close();
fake.assertDone();

const scripted = receiver.receive(createWebhookRequest(event, { login, password }));
check(scripted.kind === 'transaction.check', 'testing webhook request failed');
