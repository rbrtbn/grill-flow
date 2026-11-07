# Prototype fidelity verification

Reference: `prototype/squad-conversations` at `a95f7c3`, clean variant, chosen edition.
Working implementation: `feat/focus-workspace`, isolated preview on port 4330.

The initial implementation reused the legacy question renderer and its inherited styles rather
than the prototype's component structure. State and view tests passed, but no rendered comparison
had been performed. That missed changes to typography, spacing, disclosure and page structure.

## Corrected differences

| Surface | Difference | Correction |
| --- | --- | --- |
| Question | Larger title and answer text, taller rows, always-open note | Prototype type scale, measure, compact options, optional note |
| Explanation | Legacy hover-only headings | Permanently visible semantic headings in the workspace |
| Navigation | Different width, spacing and overview destinations | 276px default, stacked links, round list, restored destinations |
| Discussion | Different header, scope controls and full conversation | Aligned actions, stable scopes, question context and thread list |
| Review | Message and Send below the visible region | Independently scrolling table, visible composer, search and details |
| Needs you | Missing draft summary | Separate draft review, open questions and waiting dependencies |
| Run | Long combined content without section navigation | Current, Completed, Later, Sessions and Dependencies tabs |
| Squad | Missing run index | Table of catalog runs, states, attention and next destinations |

The browser also exposed a persistence bug: Command+Enter removed a focused custom-answer editor
without firing blur. Keyboard review now saves edited text and notes before navigation. Send waits
for those writes to finish. A reload check confirms the custom answer remains available.

## Evidence

The comparison uses Playwright 1.60 and Chrome with isolated browser contexts. No user browser
profile is accessed. Reference and implementation use a 1600×1000 viewport and the reference's
captured question/answer data. Browser route interception keeps all test writes in memory.

| Q14 metric | Prototype | Implementation |
| --- | --- | --- |
| Title | Literata 600, 22px / 33px | Same |
| Answer label | Literata 600, 15px / 24px | Same |
| Reading column | x=556, width=760px | Same |
| Title inset from application frame | 89px | 89px |
| Options inset from application frame | 188px | 188px |
| Answer group height | 254.78px | 253.28px |
| Explanation heading inset | 580.97px | 579.47px |
| Navigation width | 276px | 276px |

The prototype's demo banner is 18px taller than the working preview banner. Measurements are
normalized to the application frame; demonstration controls are intentionally absent in the app.

48 browser assertions pass. They cover geometry, loaded fonts, full gutter click targets,
Discuss/Close alignment, expansion, conversation scope, resizing, Settings outside click, scroll
reset, custom-answer persistence, selective keyboard send, cleared message, Run tabs and Squad.
30/60-question stress cases retain independent sidebar/table scrolling. At 1100, 720 and 390px,
questions have no page overflow and Review keeps its composer and Send fully visible.

The seven main surfaces and discussion states were also captured with actual preview data and
visually inspected. Local screenshots and measurements are ignored under
`data/visual-qa/2026-11-06-fidelity/{before,after,verified}`; they are not committed.

Reproduce while both isolated servers are running:

```sh
pyenv exec python scripts/check-workspace-fidelity.py \
  --reference-dir /path/to/squad-conversations \
  --output data/visual-qa/fidelity
```

The helper requires the existing Python Playwright installation and Chrome; it adds no app
dependency. `--reference-url` and `--working-url` can point to alternate preview ports.

## Deliberate data differences and limits

The real copied grill has 27 questions, newer answers and a different publisher session from the
prototype's captured 10-question example. Counts, work rows, replies and selected answers follow
the supplied data. They are not replaced with the prototype's illustrative values.

The existing grill format supplies no live owner-step feed or direct squad-lead routing address.
The owner-action empty state is explicit; the lead discussion scope is disabled with an explanation.
Whole-run and question discussions use the existing transport. Catalog states derive from stored
plans and answers, not live worker telemetry. These integration limits are unchanged.

The live server on 4317 and its database were not modified. The working preview uses copied data,
disables remote polling and session delivery, and retains its own write cookie.

135 unit/state/view/server tests, both TypeScript checks and the build pass. The full lint command
still stops on 27 pre-existing findings. Targeted workspace lint, Python Ruff checks and the
Impeccable layout detector pass. Wrapcheck reports only existing research-document findings.
