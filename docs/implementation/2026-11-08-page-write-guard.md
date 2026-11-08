# Packaged Claude page-write guard

Status: packaged and tested; not installed or enabled. Rob's owner step installs it per account.
This implements LAB-1353 P8's bounded Claude Bash text guard, not same-user isolation.

## Refusals and boundaries

The hook denies visible HTTP mutations naming localhost:4317 or 127.0.0.1:4317, including
explicit mutation verbs and curl data/form/upload options. It denies token reads naming the
checkout's data/token and named store accesses without recognized read-only mode. sqlite3
default opens are refused even for SELECT. Read-only gf events/state/grant, plain HTTP GET,
existence checks, explicit sqlite3 -readonly/URI mode=ro and supported readonly constructor
forms remain allowed. Mixed read-only/write commands do not inherit a read-only exemption.

The classifier reads only bounded JSON stdin. It never executes or expands the command,
reads token/store contents, contacts a server, writes settings or echoes input. Malformed Bash
hook input denies with a fixed reason. Other tools receive no decision. Literal examples in
heredocs can be refused; this is an acknowledged boundary of command-text matching.

Indirect scripts, imported store modules without a named path, alternative URL spellings,
variable-built targets, browser/computer tools and other runtimes remain outside this guard.
The guard neither authenticates a human nor makes a submission eligible for authority.

## Owner installation

There is intentionally no plugin/hooks/hooks.json. The example configuration does not load
automatically. Nothing in the build or server startup installs or enables this guard.

From the Claude account to protect, preview the installer, then explicitly apply it:

```sh
bash /Users/robertban/repos/rbrtbn/grill-flow/scripts/install-page-write-guard.sh
bash /Users/robertban/repos/rbrtbn/grill-flow/scripts/install-page-write-guard.sh --apply
```

CLAUDE_CONFIG_DIR selects that account. When it is unset, both commands refuse until given
`--settings /absolute/path/to/the/account/settings.json`. No account is inferred. Repeat for
each intended account; this installer does not edit another account or a global profile.

The script verifies Claude Code >=2.1.295 and the packaged classifier with synthetic input.
Its diff is one Bash PreToolUse hook: a versioned private script, five-second timeout and
onFailure:block. Unrelated settings and hooks are preserved. Apply atomically writes mode-0600
settings and a mode-0600 original backup in the account directory, without printing contents.
Repeated application is a no-op; an update replaces only this installer's prior hook entry.
Settings-file and guard-location symlinks are refused. The installer does not run a test POST.

Review /hooks in a fresh Claude session. To undo, restore the saved settings backup explicitly;
the versioned script can remain unused. The owner step stays open until Rob supplies evidence.

## Protocol and verification

The hook emits PreToolUse permissionDecision:deny JSON on refusal and no decision on a pass.
onFailure:block also blocks startup, timeout and malformed-output failures on supported clients.
The [official hook reference](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails)
was checked on 2026-11-08; the local version command reported Claude Code 2.1.319.
This is a protocol/version check, not proof that any account has installed the guard.

Automated tests use temporary settings, fake token/command sentinels and stub version commands.
They cover denied mutations/token/store access, explicit reads, mixed commands, malformed or
oversized input, no command execution/input echo, no implicit activation, idempotence, preserved
hooks/settings, private backup permissions, unsupported clients and symlink/malformed settings.
No real account settings, token, database or page write is used by those tests.
