# Open Paylov questions

Unresolved Paylov behavior whose answer would change the SDK: each entry gives the question, the
evidence so far, and the owning page. Unobserved behavior that would change nothing stays on its
owning page as an observation gap, without an entry. IDs are stable and never reused. Grades:
[evidence](README.md#evidence). When Paylov answers or live evidence settles a question, record the
fact on its owning page and remove the entry and every `[OPEN Qn]` marker through the
[sync-paylov-reference skill](../../.agents/skills/sync-paylov-reference/SKILL.md); an M decision
settles one only as the README's evidence rules allow.

## Q108

Which ids besides the merchant's own can be split recipients (sub-merchants, other merchants)?

On DEV the merchant's own id is the only recipient that succeeded; an unknown UUID answers
`recipient_not_found` (W c1722, c1724, c1740). Page: [Splits](splits.md#flow).
