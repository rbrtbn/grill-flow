# 0037. Summary-first questions with a comparison

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Decision
Guide revision 8 asks authors for questions the owner can answer from two things: the step's
first `prose` paragraph, a one-paragraph summary with the recommendation and why, and option
`label`s of two to five words. The rest of `prose` explains how the options trade off, and every
question with two or more options carries a `compare` table (ADR 0003) with one row per
trade-off that differs. The page can then show the summary and short answers first and fold the
rest. Guidance only: the lint and schema are unchanged. Owner's ask 9656 (page `squad`).
