# Design

A paperback gamebook, kept quiet. Sections carry their question number in the margin and end
with a "Turn to Q5" link, because the questions are numbered out of order and the reader jumps
between them. The reading column stays a plain book page.

- Ground: cool paper (`--paper`), one ink (`--ink`). Ink also carries every active and selected
  state (`--accent`, `--accent-wash`): the current tab, a pressed filter pill, the primary
  button, a picked answer. Dark mode mirrors it.
- Blue (`--link`, cobalt) is only for links. A control that is not a link never turns blue
  (Rob, 2026-11-14).
- Muted state hues, each with one meaning and always as an outline, a dot or a wash, never a
  fill behind body text:
  - ochre: open, on you, unsent;
  - olive: done, recommended;
  - violet: waiting on an agent, interactive sessions;
  - teal: confirming, a session tag;
  - rust: a freeze.

  Urgency keeps its own scale (`--u-blocking`, `--u-soon`, `--u-wait`, `--u-fyi`).
- Type: Literata for reading, headings and task titles; Archivo Narrow for labels, numbers and
  controls, with small caps for group headings; JetBrains Mono only for code and lines to
  copy.
- The header is one 56px bar in three parts. Left: the Board wordmark, then Inbox · Questions ·
  Runs · Work · More ▾ as plain tabs with ink count pills (ochre for the Inbox's count of what
  is due); everything that opens a page sits here. Centre: the squad's or session's name.
  Right: actions only (Sessions, Review & send, the freeze pill, Decisions · N open).
- Work states keep the same hues: design gate violet, building ochre, review and fixing teal,
  merge-ready and merged olive, blocked a rust hatch. The Timeline and each row's Track read one
  model (`workFlow.ts`).
- Sessions wear an avatar hue from eight muted tokens (`--av-0` … `--av-7`), picked from the
  address so it is the same on every page. The hue tells sessions apart; a session's type
  stays in text and badges.
- References (sessions, rounds, issues, PRs, keys, tasks) open one card component on hover or
  focus and pin on click (`refCard.ts`).
- The question is the one block set apart, on `--panel`. Options are rows: a lettered disc, the
  label, and a muted consequence line.
- State is shown by form, not colour alone: filled (answered), outlined (open), dashed (waiting),
  struck and faded (not needed), in the tree and on each section number.
- No coloured side stripes on cards, callouts or list items; a callout is a 1px outline on its
  wash.
- Restraint (Rob, 2026-11-02): nothing decorative competes with the text, and every question is
  one skip away from its reasoning.
