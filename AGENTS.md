# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

Domain vocabulary, deployment steps, local conventions that differ from Foldkit's defaults: write them here.

grill-flow renders a grill (an agent's structured interview about a decision) as one reading page:
reasoning in thinking order, a question at each decision point, options that state their
consequence, and questions greyed until what they depend on is answered.

### Making a page

The `grill` skill in `plugin/skills/grill/SKILL.md` owns how an agent writes a grill, loads it,
answers asks and reads the reply. `examples/` holds a whole grill; `grills/` (gitignored) holds
the live ones.

### Running

`bun run dev` serves the page and rebuilds it whenever `src/` changes; an open page sees the new
build on its next poll (4 s) and reloads itself, keeping unsent drafts. `bun run serve` serves the
last build without watching. It binds 127.0.0.1:4317 and keeps
everything in `data/grill-flow.sqlite` (gitignored), one row per answer, note, ask, revision and
send, so how pages get used can be mined later. Writes need the page's HttpOnly, SameSite=Strict
cookie, a same-origin request and a JSON body. Other local processes can still reach it, as they
can reach `hc` itself.

Not vendoring the Foldkit repo for now (decided 2026-11-02); read the installed package's types.
