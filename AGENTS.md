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

Bump `version` in `plugin/.claude-plugin/plugin.json` with every change under `plugin/`, then
run `claude plugin update grill-flow@grill-flow` in each account. Installed copies are cached
by version, so an unbumped change never reaches agents.

### Running

`bun run dev` serves the page and rebuilds it whenever `src/` changes; an open page sees the new
build on its next poll (4 s) and reloads itself, keeping unsent drafts. `bun run serve` serves the
last build without watching. It binds 127.0.0.1:4317 and keeps
everything in `data/grill-flow.sqlite` (gitignored), one row per answer, note, ask, revision and
send, so how pages get used can be mined later. Every load also keeps the whole grill as a
numbered revision, read only by `gf history` and `gf export`. Discussions stay in the
database; served snapshots carry only `discussions` references to them. The server copies the
database to `data/backups/` an hour apart with `VACUUM INTO`, keeping the newest 48;
`GF_BACKUPS=0` or `GF_PREVIEW=1` skips them. Writes need the page's HttpOnly, SameSite=Strict
cookie, a same-origin request and a JSON body. Other local processes can still reach it, as they
can reach `hc` itself.

Not vendoring the Foldkit repo for now (decided 2026-11-02); read the installed package's types.

### Delivery

Work directly on `main`. Commit and push verified changes, then update the local app on
127.0.0.1:4317 as each change lands. Preserve unrelated working files and live grill data.

### Discussion routing

Set `GF_MAINTAINER_SESSION` to this app's active builder session (a Herdr address) to expose
the **Grill-flow** discussion tab. It uses the `grill-flow` ask target and the normal
`gf revise <grill> grill-flow --ask <id> --kind comment --file <path>` reply path.
Each question's optional `session` routes answers and discussion to its asker; blank or
absent falls back to the grill's session.
The panel's "To" list also offers each running agent in the page session's Herdr space
(`agent:<address>` threads, lead first; ADR 0029). `from` and `sources` are display metadata.
`GF_DIST` can point an isolated test or preview server at a staged frontend build.
Set `GF_POLL_REMOTES=0` on isolated servers that must not pull or update remote outboxes.
