#!/usr/bin/env bash
# PROTOTYPE: serve the four discussion-threads studies on 4361-4364 (round 1) and 4365, 4367, 4368 (round 2) (run from the repo root).
set -euo pipefail
for variant in tabs timeline inbox stack under margin issue; do
  bunx vite --config "prototypes/discussion-threads-$variant/vite.config.ts" &
done
wait
