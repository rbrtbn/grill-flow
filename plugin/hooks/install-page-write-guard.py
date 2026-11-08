#!/usr/bin/env python3
"""Prepare or apply one account's explicit, idempotent guard installation."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


def atomic(path, data):
    fd, temporary = tempfile.mkstemp(prefix=".grill-flow-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(settings, apply):
    path = Path(settings).expanduser()
    if not path.is_absolute() or path.is_symlink() or not path.parent.is_dir():
        raise ValueError(
            "Use an absolute, non-symlink settings file in an existing account directory."
        )
    source = Path(__file__).with_name("page-write-guard.py")
    guard = source.read_bytes()
    digest = hashlib.sha256(guard).hexdigest()[:16]
    destination = path.parent / "grill-flow-hooks" / ("page-write-guard-" + digest + ".py")
    if destination.parent.is_symlink() or destination.is_symlink():
        raise ValueError("Refusing a symlink guard location.")
    version = subprocess.run(
        ["claude", "--version"], capture_output=True, timeout=5, check=True
    ).stdout.decode()
    match = re.match(r"(\d+)\.(\d+)\.(\d+)", version)
    if not match or tuple(map(int, match.groups())) < (2, 1, 295):
        raise ValueError("Claude Code 2.1.295 or newer is required for onFailure:block.")
    for command, denied in [
        ("echo guard-check", False),
        ("curl -X POST http://127.0.0.1:4317/synthetic", True),
    ]:
        probe = subprocess.run(
            [sys.executable, str(source)],
            input=json.dumps(
                {
                    "tool_name": "Bash",
                    "cwd": str(source.parent),
                    "tool_input": {"command": command},
                }
            ).encode(),
            capture_output=True,
            timeout=5,
            check=True,
        )
        output = json.loads(probe.stdout or b"{}")
        if (output.get("hookSpecificOutput", {}).get("permissionDecision") == "deny") != denied:
            raise ValueError("Packaged guard self-check failed.")
    original = path.read_bytes() if path.exists() else None
    settings_value = json.loads(original or b"{}")
    if not isinstance(settings_value, dict):
        raise ValueError("Settings must contain a JSON object.")
    hooks = settings_value.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("Existing hooks must be an object.")
    entries = hooks.setdefault("PreToolUse", [])
    if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
        raise ValueError("Existing PreToolUse must be a list of hook groups.")
    target = {
        "matcher": "Bash",
        "hooks": [
            {
                "type": "command",
                "command": sys.executable,
                "args": [str(destination)],
                "timeout": 5,
                "onFailure": "block",
            }
        ],
    }

    def owned(entry):
        handlers = entry.get("hooks")
        if entry.get("matcher") != "Bash" or not isinstance(handlers, list) or len(handlers) != 1:
            return False
        handler = handlers[0]
        args = handler.get("args") if isinstance(handler, dict) else None
        if not isinstance(args, list) or len(args) != 1 or not isinstance(args[0], str):
            return False
        prior = Path(args[0])
        return (
            prior.parent == destination.parent
            and re.fullmatch(r"page-write-guard-[a-f0-9]{16}\.py", prior.name) is not None
        )

    updated = [entry for entry in entries if not owned(entry)] + [target]
    hooks["PreToolUse"] = updated
    same = entries == updated and destination.is_file() and destination.read_bytes() == guard
    if same:
        print("Guard already configured; no changes.")
        return
    if not apply:
        print(
            "Dry run: copy the versioned guard and add one Bash PreToolUse hook with timeout=5 and onFailure=block. Other settings and hooks are preserved."
        )
        return
    destination.parent.mkdir(mode=0o700, exist_ok=True)
    os.chmod(destination.parent, 0o700)
    if original is not None:
        backup = path.with_name(path.name + ".grill-flow-backup-" + str(time.time_ns()))
        atomic(backup, original)
    atomic(destination, guard)
    atomic(path, (json.dumps(settings_value, indent=2) + "\n").encode())
    print(
        "Guard configured. Review /hooks in a fresh Claude session; test with synthetic hook input only."
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--settings")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    config = os.environ.get("CLAUDE_CONFIG_DIR")
    settings = args.settings or (str(Path(config) / "settings.json") if config else None)
    if settings is None:
        parser.error(
            "Choose an account with CLAUDE_CONFIG_DIR or --settings /absolute/path/settings.json."
        )
    try:
        install(settings, args.apply)
    except Exception:
        print(
            "Guard installation refused or failed. Check the account path, JSON hook structure and Claude version; no settings contents are printed.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
