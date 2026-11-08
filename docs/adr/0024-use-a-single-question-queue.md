# 0024. Use a single question queue

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Replace the app and round rails with one queue and header destinations.
Keep Open, Drafts and All on one row; move advanced filters to a native popover.
Scope by matching source-qualified rounds and keep a zero-match selection visible.
Put less frequent destinations in More and Review & send at the far right.
Keep question dependency trees, source context, inbox and full accessible titles.
Remove round renaming controls and the Whole run discussion button.
Preserve saved filters, global draft review, run history, routes and delivery behavior.
Native popovers own transient opening/focus; filter values remain in the Foldkit Model.
