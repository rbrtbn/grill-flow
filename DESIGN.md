# Design

A paperback gamebook, kept quiet. Sections carry their question number in the margin and end
with a "Turn to Q5" link, because the questions are numbered out of order and the reader jumps
between them. The reading column stays a plain book page.

- Ground: cool paper (`--paper`), one ink (`--ink`), one link ink (`--link`, cobalt) that also marks
  answered and selected states. Dark mode mirrors it.
- Type: Literata for reading and headings; Archivo Narrow for labels, numbers and controls;
  JetBrains Mono only for code.
- The question is the one block set apart, on `--panel`. Options are rows: a lettered disc, the
  label, and a muted consequence line.
- State is shown by form, not colour alone: filled (answered), outlined (open), dashed (waiting),
  struck and faded (not needed), in the tree and on each section number.
- Restraint (Rob, 2026-11-02): nothing decorative competes with the text, and every question is
  one skip away from its reasoning.
