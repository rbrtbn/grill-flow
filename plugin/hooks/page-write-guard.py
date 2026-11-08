#!/usr/bin/env python3
"""Classify visible Claude Bash text without executing or expanding it."""

import json
import os
import re
import shlex
import sys

LIMIT = 1_048_576
ENDPOINT = re.compile(
    r"(?i)(?<![\w.-])(?:https?://)?(?:localhost|127\.0\.0\.1):4317(?=[/\s'\"?]|$)"
)
STORE = re.compile(r"(?<![\w.-])grill-flow\.sqlite(?:-(?:wal|shm))?(?![\w.-])")
TOKEN = re.compile(r"(?:^|[/\s'\"(])data/token(?![\w.-])")
MUTATION = re.compile(
    r"(?i)\b(?:POST|PUT|PATCH|DELETE)\b|--(?:data(?:-[a-z]+)?|form(?:-string)?|json|upload-file)(?:[=\s]|$)"
)
CURL_DATA = re.compile(r"(?:^|\s)-(?!-)[a-zA-Z]*[dFT]")
CALL = re.compile(r"(?:\bDatabase|\bsqlite3\.connect|\bopen)\s*\(([^()]*)\)")
REASONS = {
    "input": "Grill-flow guard refused malformed hook input.",
    "http": "Grill-flow guard refuses direct page HTTP mutations. Use the page for owner answers.",
    "token": "Grill-flow guard refuses page token reads.",
    "store": "Grill-flow guard refuses named store writes or opens without explicit read-only mode. Use gf events for history.",
}


def tokens(text):
    lexer = shlex.shlex(text, posix=True, punctuation_chars=";&|")
    lexer.whitespace_split = True
    lexer.commenters = ""
    return list(lexer)


def metadata_only(command):
    parts = tokens(command)
    if len(parts) == 3 and parts[0] == "test" and parts[1] in {"-e", "-f"}:
        return True
    if len(parts) == 4 and parts[0] == "[" and parts[1] in {"-e", "-f"} and parts[3] == "]":
        return True
    return len(parts) == 2 and parts[0] == "stat"


def readonly_call(match):
    body = match.group(1)
    if not STORE.search(body):
        return match.group(0)
    if match.group(0).startswith("Database"):
        safe = re.search(r"\breadonly\s*:\s*true\b", body) and not re.search(
            r"\breadonly\s*:\s*(?!true\b)\S+", body
        )
    elif match.group(0).startswith("sqlite3.connect"):
        safe = readonly_uri(body) and re.search(r"\buri\s*=\s*True\b", body)
    else:
        safe = re.search(r",\s*['\"]r[b]?['\"]\s*(?:,|$)", body)
    return " " * len(match.group(0)) if safe else match.group(0)


def readonly_uri(text):
    return re.findall(r"[?&]mode=([^&'\"\s,)]*)", text) == ["ro"]


def readonly_store(command):
    remainder = CALL.sub(readonly_call, command)
    if not STORE.search(remainder):
        return True
    # Only a literal sqlite3 file argument establishes read-only mode for that open.
    segments = [[]]
    for part in tokens(remainder):
        if part and all(character in ";&|" for character in part):
            segments.append([])
        else:
            segments[-1].append(part)
    for parts in segments:
        if not STORE.search(" ".join(parts)):
            continue
        if not parts or os.path.basename(parts[0]) != "sqlite3":
            return False
        flags = []
        while len(parts) > 1 and parts[1].startswith("-"):
            flags.append(parts.pop(1))
        if len(parts) < 2 or not STORE.search(parts[1]):
            return False
        if any(flag not in {"-readonly", "--readonly", "-uri"} for flag in flags):
            return False
        if not ({"-readonly", "--readonly"} & set(flags)) and not readonly_uri(parts[1]):
            return False
        if STORE.search(" ".join(parts[2:])) or re.search(
            r"(?i)\.(?:open|restore|import|backup)\b", " ".join(parts[2:])
        ):
            return False
    return True


def refusal(command, cwd):
    parts = tokens(command)
    if metadata_only(command):
        return None
    if TOKEN.search(command):
        # Relative data/token names are protected in the checkout, absolute ones by path.
        in_checkout = "grill-flow" in os.path.normpath(cwd).split(os.sep)
        qualified = re.search(r"(?:^|/)grill-flow/data/token\b", command)
        if in_checkout or qualified:
            return "token"
    if ENDPOINT.search(command):
        if MUTATION.search(command) or CURL_DATA.search(command):
            return "http"
        for i, part in enumerate(parts):
            if part in {"-X", "--request"}:
                if i + 1 >= len(parts) or parts[i + 1].upper() not in {"GET", "HEAD", "OPTIONS"}:
                    return "http"
            elif part.startswith("--request=") or (part.startswith("-X") and len(part) > 2):
                method = part.split("=", 1)[1] if "=" in part else part[2:]
                if method.upper() not in {"GET", "HEAD", "OPTIONS"}:
                    return "http"
    if STORE.search(command) and not readonly_store(command):
        return "store"
    return None


def decision(value):
    if not isinstance(value, dict) or not isinstance(value.get("tool_name"), str):
        return "input"
    if value["tool_name"] != "Bash":
        return None
    body = value.get("tool_input")
    cwd = value.get("cwd")
    if (
        value.get("hook_event_name", "PreToolUse") != "PreToolUse"
        or not isinstance(body, dict)
        or not isinstance(body.get("command"), str)
        or not isinstance(cwd, str)
        or not os.path.isabs(cwd)
        or "\x00" in body["command"]
        or "\x00" in cwd
    ):
        return "input"
    return refusal(body["command"], cwd)


def main():
    reason = "input"
    try:
        raw = sys.stdin.buffer.read(LIMIT + 1)
        if len(raw) <= LIMIT:
            reason = decision(json.loads(raw))
    except Exception:
        # Diagnostics must never include command text, credentials or parser excerpts.
        reason = "input"
    if reason is not None:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": REASONS[reason],
                    }
                }
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
