#!/usr/bin/env bash
# PROTOTYPE: serve the four discussion-threads studies on 4361-4364 (run from the repo root).
set -euo pipefail
for variant in tabs timeline inbox stack; do
  bunx vite --config "prototypes/discussion-threads-$variant/vite.config.ts" &
done
wait
