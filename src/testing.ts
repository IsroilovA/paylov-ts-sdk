/**
 * The `@isroilov_an/paylov/testing` entry point: an in-memory gateway and webhook requests for
 * application tests. Never import it from production code.
 */

export { PaylovFakeGateway, type PaylovFakeCall } from './testing/gateway.js';
export { createWebhookRequest } from './testing/webhooks.js';
export type {
  PaylovFakeFailure,
  PaylovFakeMethod,
  PaylovFakeSchedule,
  PaylovFakeSurface,
} from './core/fake.js';
