#!/usr/bin/env bash
# Refreshes the installed grill-flow plugin in both Claude accounts after a version bump.
set -euo pipefail
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' \
  "$HOME/repos/rbrtbn/grill-flow/plugin/.claude-plugin/plugin.json")
for dir in "$HOME/.claude_personal" "$HOME/.claude_work"; do
  echo "== $dir"
  CLAUDE_CONFIG_DIR="$dir" claude plugin marketplace update grill-flow
  CLAUDE_CONFIG_DIR="$dir" claude plugin update grill-flow@grill-flow
  test -d "$dir/plugins/cache/grill-flow/grill-flow/$version" \
    && echo "installed $version" || echo "WARNING: $version not in $dir cache"
done
echo "New sessions load the bootstrap; running ones keep the old skill until restarted."
