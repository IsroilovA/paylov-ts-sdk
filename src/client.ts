import { TokenManager } from './core/auth.js';
import { readSurfaceTransport } from './core/config.js';
import { createHttpClient } from './core/http.js';
import { ClientLifecycle } from './core/lifecycle.js';
import { readCallSignal, readConfig } from './core/params.js';
import type { PaylovCallOptions, PaylovTransportConfig } from './core/types.js';
import { createCardsResource, type CardsResource } from './cards/resource.js';
import {
  createFiscalizationResource,
  type FiscalizationResource,
} from './fiscalization/resource.js';
import { createGatewayResource, type GatewayResource } from './gateway/resource.js';
import { createHoldsResource, type HoldsResource } from './holds/resource.js';
import { createPaymentsResource, type PaymentsResource } from './payments/resource.js';
import { createSplitsResource, type SplitsResource } from './splits/resource.js';
import { createSubMerchantsResource, type SubMerchantsResource } from './subMerchants/resource.js';
import { createTransactionsResource, type TransactionsResource } from './transactions/resource.js';

/** Configuration for `PaylovClient`. Retries are not configurable: only GET requests retry. */
export interface PaylovClientConfig extends PaylovTransportConfig {
  /**
   * Gateway origin with no path: DEV `https://dev.gw.paylov.uz`, PROD `https://gw2.paylov.uz`.
   * Required, with no default. Must use `https`; a path, including `/merchant`, is rejected.
   */
  readonly baseUrl: string;
  readonly consumerKey: string;
  /** Secret. Never logged, never quoted in an error message. */
  readonly consumerSecret: string;
  readonly username: string;
  /** Secret. Never logged, never quoted in an error message. */
  readonly password: string;
}

/**
 * Server-side client for the Paylov payment gateway.
 *
 * Create one long-lived instance per merchant credential set per process and share it across
 * requests. It keeps the OAuth2 token pair in memory and refreshes it transparently; tokens are
 * not coordinated across processes.
 *
 * @example
 * import { PaylovClient } from '@isroilov_an/paylov';
 *
 * const paylov = new PaylovClient({
 *   baseUrl: 'https://dev.gw.paylov.uz',
 *   consumerKey: paylovConsumerKey,
 *   consumerSecret: paylovConsumerSecret,
 *   username: paylovUsername,
 *   password: paylovPassword,
 * });
 * // ... on shutdown:
 * await paylov.close();
 *
 * @throws {@link PaylovInputError} `sdk_config_error` for malformed configuration.
 */
export class PaylovClient {
  /**
   * Gateway liveness and the bank list. See docs/usage/setup.md.
   * @example await paylov.gateway.getStatus({ signal: AbortSignal.timeout(5_000) });
   */
  readonly gateway: GatewayResource;
  /**
   * Card Bind links, PAN binding, saved cards and the phone check. Moves no money.
   * See docs/usage/cards.md.
   * @example const cards = await paylov.cards.list({ userId: 'user-42' });
   */
  readonly cards: CardsResource;
  /**
   * Receipt payments with a saved card, one-off PAN payments and refunds. See
   * docs/usage/payments.md.
   * @example await paylov.payments.pay({ transactionId, cardId, userId: 'user-42' });
   */
  readonly payments: PaymentsResource;
  /**
   * Transaction lookups, paid-transaction listings and RRNs. See docs/usage/transactions.md.
   * @example const transaction = await paylov.transactions.get({ transactionId });
   */
  readonly transactions: TransactionsResource;
  /**
   * Two-phase card holds: create, capture once, release. See docs/usage/holds.md.
   * @example await paylov.holds.release({ transactionId: holdTransactionId });
   */
  readonly holds: HoldsResource;
  /**
   * Splits of a paid transaction between recipients. See docs/usage/splits.md.
   * @example const shares = await paylov.splits.get({ transactionId });
   */
  readonly splits: SplitsResource;
  /**
   * OFD fiscal receipts and activity-type checks. See docs/usage/fiscalization.md.
   * @example const receipt = await paylov.fiscalization.registerReceipt({ transactionId, items });
   */
  readonly fiscalization: FiscalizationResource;
  /**
   * Sub-merchant registration for splits. See docs/usage/splits.md.
   * @example const { subMerchantId } = await paylov.subMerchants.create(subMerchantParams);
   */
  readonly subMerchants: SubMerchantsResource;

  readonly #auth: TokenManager;

  constructor(config: PaylovClientConfig) {
    const params = readConfig(config, 'PaylovClient config');
    const transport = readSurfaceTransport(params);
    const lifecycle = new ClientLifecycle();
    // The token transport has neither auth nor the lifecycle: grants never recurse into the
    // manager, and revocation still runs after the client is closed.
    this.#auth = new TokenManager({
      http: createHttpClient(transport),
      lifecycle,
      consumerKey: params.string('consumerKey'),
      consumerSecret: params.string('consumerSecret'),
      username: params.string('username'),
      password: params.string('password'),
    });
    const http = createHttpClient({ ...transport, lifecycle, auth: this.#auth });
    const anonymousHttp = createHttpClient({ ...transport, lifecycle });

    this.gateway = createGatewayResource(http, anonymousHttp);
    this.cards = createCardsResource(http);
    this.payments = createPaymentsResource(http);
    this.transactions = createTransactionsResource(http);
    this.holds = createHoldsResource(http);
    this.splits = createSplitsResource(http);
    this.fiscalization = createFiscalizationResource(http);
    this.subMerchants = createSubMerchantsResource(http);
  }

  /**
   * Closes the client, waits for a token grant already under way, then revokes the access token
   * (`POST /merchant/oauth2/revoke/`, sent without `Authorization`). The SDK assumes the revoked
   * token stops authorizing at once on production; on the development gateway it keeps working.
   * Every later call throws `PaylovClientClosedError` `sdk_client_closed`. A request still in
   * flight may also fail with it once the revocation lands; Paylov rejected it before running it,
   * so it had no effect. Settle requests before closing to keep their results. Concurrent calls
   * share one revocation. Resolves once the client is closed locally even when the revocation fails or
   * `signal` abandons the wait: the revoke attempt's `logger` events report its outcome, metadata
   * only.
   *
   * @throws {@link PaylovInputError} `sdk_invalid_input` for options without an `AbortSignal`.
   *
   * @example
   * process.once('SIGTERM', () => {
   *   void paylov.close({ signal: AbortSignal.timeout(5_000) });
   * });
   */
  async close(options?: PaylovCallOptions): Promise<void> {
    await this.#auth.close(readCallSignal(options, 'client.close'));
  }
}
