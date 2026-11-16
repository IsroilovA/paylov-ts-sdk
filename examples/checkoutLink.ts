/**
 * Build a hosted-checkout link for a 500 SUM order and show what the checkout page receives.
 *
 * Run with: `npx tsx examples/checkoutLink.ts`
 *
 * SECURITY: the link is not signed. Its amount, currency and account are only base64-encoded,
 * so your `transaction.check` handler must re-validate all three against your own order record
 * before answering `accept`.
 */

// In your own code this is `from '@isroilov_an/paylov'`; in-repo it resolves to the same entry point.
import { createCheckoutUrl } from '../src/index.js';

const paylovMerchantId =
  process.env['PAYLOV_MERCHANT_ID'] ?? '5eed0000-0000-4000-8000-0000000000aa';

const url = createCheckoutUrl({
  merchantId: paylovMerchantId,
  amount: { currency: 860, amountTiyin: 50_000 }, // 500.00 SUM
  account: { order_id: 'A-1001' }, // echoed back in the check and perform callbacks
  returnUrl: 'https://shop.example/checkout/return',
});

console.log('checkout link:\n%s\n', url);

// The payload is the last path segment: standard base64 of a form-encoded query.
const payload = new URL(url).pathname.split('/').at(-1) ?? '';
console.log('decoded query:\n%s', atob(payload));
