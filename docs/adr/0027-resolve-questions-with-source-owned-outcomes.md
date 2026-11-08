# 0027. Resolve questions with source-owned outcomes

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Allow answered-question removal with a nonblank decided outcome keyed by its local id.
Use existing decided metadata rather than adding a parallel archive or resolved-state API.
Preserve answer events, frozen submissions, shared identities and all existing history.
Keep picked-key protection for questions that remain, including partly resolved questions.
An outcome records author-reported resolution; it does not grant additional approval.
Apply the same guard to local loads, outbox queues and accepting-host imports.
Guide revision 2 teaches taking down resolved questions and retaining open work.
