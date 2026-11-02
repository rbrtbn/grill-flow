# 0001. Version the grill format

- Status: accepted
- Date: 2026-11-02
- Scope: grill-flow

## Context
Squad orchestrators write grills while the page changes under them, so an older run can meet a
newer page and the reverse. The plan block (issues, gates, deadline) is the first addition that
an older orchestrator won't send.

## Decision
A grill carries `version` (absent means 1; 2 adds `plan`). New fields are optional and decode is
lenient: unknown keys are dropped and open-ended values such as a plan issue's `phase` are
strings with a fallback, so neither side breaks the other. A grill newer than the page loads and
says so on its Overview and in `gf load`.

## Alternatives rejected
Fixed-value literals for new fields: one unknown value would reject the whole grill. A separate
plan file: two writes per round that can drift apart.
