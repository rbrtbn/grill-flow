# Live reference readings

The page refreshes validated GitHub PR/issue and rbrtbn Linear issue references in the
background. Source grill JSON stays unchanged. A Snapshot adds optional `referenceReadings`;
its projected existing `grill.refs` carry current state and checked context for the chips.
Shared keys naming different targets become Ambiguous text without a link. A direct source
page retains its own reference. Unidentified PR numbers and arbitrary URLs are never fetched.

## Fixed reads and identity

GitHub uses `gh api user --hostname github.com --jq '{login:.login}'`, requiring rbrtbn, then
fixed `gh pr view <canonical-url> --json number,title,state,isDraft,statusCheckRollup,url` or
`gh issue view <canonical-url> --json number,title,state,url`. Successful account identity is
cached for 15 minutes; failures retry after a minute. Returned number and canonical URL must
match the request. Issue/PR bodies, reviews, comments and labels are not requested.

Linear uses `linear-snapshot --workspace rbrtbn LAB-1280 <requested-id>`, omitting the duplicate
identifier when requesting LAB-1280 itself. Its workspace field echoes the flag, so each read
also verifies LAB-1280's immutable UUID `d2694e39-f07e-42e0-abde-7eda89b0ffce`, the exact
requested identifier and a recent fetched time. The UUID was verified from a primary snapshot
at 2026-11-07T22:18:05Z. A different workspace with matching issue labels cannot satisfy it.
If that anchor is deleted, readings fail closed until its replacement is independently checked.

Only fixed argv pass the process allowlist, without a shell. No write, merge, comment, label,
arbitrary API route or content-supplied command is accepted. Credentials remain in the installed
tools. Raw stdout, stderr, descriptions and unknown provider fields are not returned, logged or
stored. Known token-like title text is redacted; retained text is bounded and control-free.

## Bounds and freshness

Two provider jobs and two CLI reads can run concurrently. The command queue and job queue each
hold at most 64 entries. All CLI reads, including identity probes, share a 24-per-minute limit.
Each process has a six-second timeout and two-megabyte output limit. The cache holds at most
256 canonical references and coalesces copies of the same target across source pages.

Refresh is requested only by page reads, at most once a minute per reference. No page response
waits for a provider. Fresh evidence expires after ten minutes; an explicit read error makes
the last result stale immediately. Restarted readers retain dated last-known results as stale
until rechecked. Missing, pending, failed, unknown and unsupported check states never imply
passed checks. A merged PR remains distinct from its check results.

`reference-checked` events store only normalized version-1 readings under canonical source
grills, in the existing event table. They append when status, title, checks or availability
changes; unchanged refreshes update the in-memory checked time without heartbeat events.
A store error does not strand the provider worker; later page reads retry recording.

## Blockers and authority

A primary reading evaluates only the exact reference of a named provider-evidence item.
Fresh matching evidence may satisfy a merged-PR or issue-state condition. Stale, unavailable,
future-dated, mismatched or unknown evidence remains unknown. Absent named evidence is not
invented. Legacy snapshots retain the separately labelled agent-reported evidence behavior.

Owner steps and grant requirements have independent evaluation paths. A merged PR, completed
issue or passed check cannot satisfy them. Provider readings are not page answers, submission
receipts, runtime acknowledgments or grant authority.

Set `GF_POLL_PROVIDERS=0` for isolated servers. Preview mode always disables provider calls.
`gf up` forwards this flag with the other server environment settings. Browser acceptance
uses projected fixtures and intercepts all writes; process tests replace both tools with fakes.
