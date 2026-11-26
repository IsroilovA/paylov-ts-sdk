/** Offline client, webhook and testing-entry integration; also run from the packed package. */

import {
  PaylovClient,
  PaylovWebhookReceiver,
  formatSum,
  isPaylovError,
  sumToTiyin,
  type FetchLike,
} from '../src/index.js';
import { PaylovFakeGateway, createWebhookRequest, startGatewaySimulator } from '../src/testing.js';

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
const receiver = new PaylovWebhookReceiver({ credentials: [{ login, password }] });
const event = receiver.receive({
  method: 'POST',
  headers: { authorization: 'Basic ' + btoa(login + ':' + password) },
  body: {
    jsonrpc: '2.0',
    method: 'transaction.cancel',
    params: {
      transaction_id: '9b3bd7be-9327-4608-b886-4353e49df05f',
      status: 'cancelled',
      account: { order_id: '12345' },
      amount: 1500,
      amount_in_tiyin: 150000,
      cancel_time: 1767162243,
    },
  },
});
if (event.kind !== 'transaction.cancel') throw new Error('webhook integration failed');
check(event.amountTiyin === 150_000 && event.credentialIndex === 0, 'webhook integration failed');

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

const simulator = await startGatewaySimulator();
check(simulator.url.startsWith('http://127.0.0.1:'), 'testing simulator failed');
await simulator.close();

const scripted = receiver.receive(createWebhookRequest(event, { login, password }));
check(scripted.kind === 'transaction.cancel', 'testing webhook request failed');
