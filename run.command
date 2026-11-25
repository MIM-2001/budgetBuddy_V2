#!/bin/bash
# Run with an installed Node, or the Node already bundled with ChatGPT on this Mac.
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  budgetbuddy_node="$(command -v node)"
elif [ -x '/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node' ]; then
  budgetbuddy_node='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'
else
  echo 'Node.js 20 or newer is required. Install Node.js, then run node main.js.'
  exit 1
fi
if [ "$1" = '--test' ]; then
  shift
  exec "$budgetbuddy_node" --test "$@"
fi
exec "$budgetbuddy_node" main.js "$@"
