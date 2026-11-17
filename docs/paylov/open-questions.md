# Open Paylov questions

Unresolved Paylov behavior: each entry gives the question, the evidence so far, and the owning page.
IDs are stable and never reused. Grades: [evidence](README.md#evidence). When Paylov answers or live
evidence settles a question, record the fact on its owning page and remove the entry and every
`[OPEN Qn]` marker through the
[sync-paylov-reference skill](../../.agents/skills/sync-paylov-reference/SKILL.md); an M decision
settles one only as the README's evidence rules allow.

## Q10

Does a non-default hold `serviceId` change who receives or settles the captured funds?

`serviceId` must exist (`service_not_found`, W c208) and defaults to the merchant id (W c184); DEV
has no second service. Page: [Holds](holds.md).

## Q29

What do `sms.hash` and `sms.templateId` change?

Bind and PWR completed alike with `sms` omitted, `{}`, `{hash}` or `{hash, templateId: 1}` (W
c725–c727, c729–c731, c733–c735, c737, c738, c1353–c1361, c1365–c1373); a string, an array or a
non-integer `templateId` is `validation_error` (W c728, c732, c736, c739, c1363). Card binding lists
`sms` without a description, and the PWR pages omit it (D). Page:
[Cards](cards.md#create-user-card), [Payments](payments.md#payment-without-registration).

## Q32

Which payment kinds does Paylov fiscalize itself, and when must the merchant register a receipt?

No page states automatic fiscalization (D); on the DEV merchant, which has no fiscalization, a paid
payment has an empty `ofd` array (W c125, c1300) and status returns the no-receipt `success: false`
shape (W c274, c1305–c1307). Page: [Fiscalization](fiscalization.md).

## Q59

Where do a split's fiscalization results appear, and when is a resend with `resendOFD: true` safe?

The docs say to resend when the response lacks OFD data, yet the documented success carries none
(D); item validation matches OFD register (W c220), and splits answer `permission_denied` on the DEV
merchant (W c1452). Page: [Splits](splits.md).

## Q86

Which `getTransactions` status does each of these read, and is it the same on production as on DEV:
a sale refunded by `payment/cancel`, a hold dismissed with `hold/dismiss`, a hold Paylov released
after expiry, and a captured hold refunded by `payment/cancel`? Do `cancel` and `refunded` ever mark
the same kind of event?

The vendor page describes `cancel` as "Cancelled" and `refunded` as "Refunded" (D). On DEV, `cancel`
marked the refunded sale (W c113); `refunded` appeared once, on a 1-minute hold released after a
charge answered `hold_time_expired`, with `cancel_time` set and `is_hold: true` (W c1280). No
dismissed hold was read through `getTransactions`, and DEV answered `processing_error` to
`payment/cancel` on a captured hold (W c557, c559, c561, c887). Page:
[Transactions](transactions.md#fields-of-transactions).

## Q87

Will REST transaction reads ever return the `account` keys a payment was created with?

`getTransactions` returns `account: {}` whatever was sent (W c087, c346), while the GraphQL
`getCheck` read returned every sent key (W c1151–c1153, c1166–c1171). Page:
[Payments](payments.md#common-rules).
