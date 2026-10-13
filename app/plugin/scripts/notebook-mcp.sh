#!/bin/sh
# Launch the notebook's stdio MCP server (app/server/mcp-stdio.ts) with the app's own tsx.
# The app folder is found in this order:
#   1. $NOTEBOOK_APP_DIR, if set
#   2. the folder that contains this plugin (local install: claude --plugin-dir <app>/plugin)
HERE="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)"

for d in "$NOTEBOOK_APP_DIR" "$HERE"; do
  if [ -n "$d" ] && [ -f "$d/server/mcp-stdio.ts" ] && [ -e "$d/node_modules/.bin/tsx" ]; then
    exec "$d/node_modules/.bin/tsx" "$d/server/mcp-stdio.ts"
  fi
done

echo "common-bench: can't find the notebook app. Set NOTEBOOK_APP_DIR to the folder that contains server/mcp-stdio.ts, and run npm install there." >&2
exit 1
