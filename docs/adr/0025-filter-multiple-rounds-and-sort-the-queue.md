# 0025. Filter multiple rounds and sort the queue

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Keep matching-round checkboxes inside Filters and combine selected rounds with OR.
Persist round arrays per grill; migrate earlier scalar scopes to one-element arrays.
Count round selection, urgency and Sent as advanced criteria on the Filters badge.
Keep quick views and search visible without counting them again on that badge.
Persist Round as the default order, with global Urgency and Recency alternatives.
Keep dependency trees intact and rank a branch by its most urgent or newest member.
Recency uses stable numbered question ids; unnumbered sets use reverse source order.
Question navigation adds its round to an active selection, retaining others.
