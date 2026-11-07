# 0014. Separate owner reports from delivery evidence

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Owner steps, provisional decisions, evidence and blockers use immutable source-owned revisions.
Completion is an agent report with proof; dated evidence clears only its named condition.
Freeze the exact decision and server-checked deadline before sending a page veto, so retries
cannot change its words or silently repeat delivery. Pending and failed receipts remain visible.
Delivery, acknowledgment and owner-reported outcome stay separate; none confers grant authority.
A terminal destination names only a published local tN address and invokes fixed focus argv.
Remote outboxes require links, because an unqualified remote tN could target the wrong host.
This keeps owner work useful without treating terminal delivery as consumption or execution.
