# 0003. Draw diagrams from data the agent writes

- Status: accepted
- Date: 2026-11-04
- Scope: grill-flow

## Context
Some decisions are about a boundary or an owner moving, which prose explains slowly. Rob wanted a
question's overview and several smaller diagrams in the reasoning and Talk, chosen by the agent.

## Decision
A question takes an optional `compare` (today beside each answer, problems flagged), drawn under
its options. Prose, rewrites and Talk replies take ```` ```diagram ```` blocks of JSON in a fixed
set of kinds (`zones`, `flow`, `compare`) and `###` paragraph titles; a diagram's `follow` pins
it over the paragraphs it names. Format version 3. Prototype: branch `prototype/boundary-diagrams`.

## Alternatives rejected
Agent-written SVG or HTML: script injection on a page that holds a write cookie, and no theming.
Mermaid: a large dependency for layouts the fixed kinds already cover.
