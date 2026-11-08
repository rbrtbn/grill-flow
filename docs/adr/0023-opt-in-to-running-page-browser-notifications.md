# 0023. Opt in to running-page browser notifications

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Keep browser notifications off until an explicit page action and the browser's permission allow them.
Alert on observed blocking/soon question and owner-step transitions while the page runs.
Deduplicate canonical source/item identities with event versions and browser-local attempts.
Serialize tabs and persist an attempt before OS effects; unsupported coordination stays off.
Seed initial state quietly and retain independent delivery, reading, action and authority meanings.
Open source-qualified items in a new tab to preserve the current page's uncontrolled drafts.
This adds no service worker, closed-page sender, phone/Slack adapter or credentials.
