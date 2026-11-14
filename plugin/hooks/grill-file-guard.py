#!/usr/bin/env python3
"""Deny hand edits of a loaded grill file and point the agent at the gf edit commands.

Advisory and fail-open (docs/adr/0034): only a clear match denies. A grill file is
`grills/<id>.json` inside a grill-flow checkout, and it counts as loaded once it exists, since
round 1 creates it and loads it. Bash text is matched, never executed; a path it cannot resolve
(variables, globs) is let through.
"""

import json
import os
import re
import sys

LIMIT = 1_048_576
GRILL_PATH = r"""(?:[^\s'"`;&|<>()]*/)?grills/[\w.-]+\.json"""
QUOTED = r"""['"]?(""" + GRILL_PATH + r""")['"]?"""
# Each pattern captures the grill path a command writes to.
BASH_WRITES = [
    # Redirection and tee: `> grills/x.json`, `>> ...`, `| tee [-a] ...`.
    re.compile(r"(?:^|[^<>&\d])>{1,2}\|?\s*" + QUOTED),
    re.compile(r"\btee\b(?:\s+-[a-z]+)*\s+" + QUOTED),
    # In-place editors whose segment names the file.
    re.compile(r"\b(?:sed|perl|gsed)\b[^;&|\n]*?\s-[a-zA-Z]*i[^;&|\n]*?\s" + QUOTED),
    # mv/cp onto the file: it is the last word of the segment.
    re.compile(r"\b(?:mv|cp)\b[^;&|\n]*\s" + QUOTED + r"\s*(?:$|[;&|\n])"),
    # Interpreter writes naming the file literally.
    re.compile(r"""\bopen\(\s*""" + QUOTED + r"""\s*,\s*['"](?:w|a|r\+|x)[bt+]?['"]"""),
    re.compile(r"""Path\(\s*""" + QUOTED + r"""\s*\)\s*\.write_(?:text|bytes)\("""),
    re.compile(r"""\b(?:writeFileSync|writeFile|Bun\.write)\(\s*""" + QUOTED),
]
REASON = (
    "grill-flow: {path} is a loaded grill. Edit the stored grill, not the file: "
    "`gf get {id}` prints its JSON and rev, then "
    "`gf question add|update|resolve {id} <question-id-or-key> --file <json> "
    "--expect-rev <rev> --reason \"<why>\"` or "
    "`gf patch {id} --file <ops.json> --expect-rev <rev> --reason \"<why>\"`. "
    "Hand edits skip the rev check and overwrite other sessions' writes. "
    "To restructure most of a grill, write a new file outside grills/ and "
    "`gf load` it with --expect-rev. Creating a new grill file stays allowed."
)


def checkout_grill(path, cwd):
    """The grill id when `path` is an existing grills/<id>.json of a grill-flow checkout."""
    full = os.path.normpath(os.path.join(cwd, os.path.expanduser(path)))
    folder = os.path.dirname(full)
    if os.path.basename(folder) != "grills" or not full.endswith(".json"):
        return None
    checkout = os.path.dirname(folder)
    if not os.path.isfile(os.path.join(checkout, "server", "authoring-guide.md")):
        return None
    if not os.path.isfile(full):
        return None
    return os.path.basename(full)[: -len(".json")]


def bash_target(command, cwd):
    for pattern in BASH_WRITES:
        for match in pattern.finditer(command):
            path = match.group(1)
            if "$" in path or "*" in path:
                continue
            grill = checkout_grill(path, cwd)
            if grill is not None:
                return path, grill
    return None


def decision(value):
    if not isinstance(value, dict):
        return None
    tool = value.get("tool_name")
    body = value.get("tool_input")
    cwd = value.get("cwd")
    if not isinstance(body, dict) or not isinstance(cwd, str) or not os.path.isabs(cwd):
        return None
    if tool in {"Write", "Edit", "MultiEdit"}:
        path = body.get("file_path")
        if not isinstance(path, str):
            return None
        grill = checkout_grill(path, cwd)
        return None if grill is None else (path, grill)
    if tool == "Bash" and isinstance(body.get("command"), str):
        return bash_target(body["command"], cwd)
    return None


def main():
    # Outbox writers have no stored grill to edit here (gf question and patch refuse GF_OUTBOX).
    if os.environ.get("GF_OUTBOX"):
        return 0
    try:
        raw = sys.stdin.buffer.read(LIMIT + 1)
        found = decision(json.loads(raw)) if len(raw) <= LIMIT else None
    except Exception:
        found = None
    if found is not None:
        path, grill = found
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": REASON.format(path=path, id=grill),
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
