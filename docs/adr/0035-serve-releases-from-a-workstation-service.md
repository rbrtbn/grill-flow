# 0035. Serve releases from a workstation service

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Decision
The page server runs as a launchd service on the workstation, serving the latest GitHub release
from its own copy; homelab can reboot locked, so it stays an option, not the host. Bumping
`package.json`'s version on `main` releases: CI tags `v<version>` and publishes a release once
the tests pass. The store lives at `~/.local/share/grill-flow/data/`, outside every checkout and
release copy; a checkout's `gf` uses it once it exists, so agents keep their `bun run --cwd
<checkout> gf`. The page token, `remotes.json`, backups and the maintainer file sit beside the
store. `gf maintainer set` writes the maintainer, which the server reads per snapshot;
`GF_MAINTAINER_SESSION` only seeds it. A loaded `local.personal.grill-flow` service owns port
4317, and `gf up` never starts a second server beside it. Service and updater live in dotfiles.
