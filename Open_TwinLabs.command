#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null || ! command -v python3 >/dev/null; then
  echo 'Install Node.js 22+ and Python 3.9+ first, then reopen this file.'
  read -r -p 'Press Enter to close.'
  exit 1
fi
if [ ! -d node_modules ]; then npm ci || exit 1; fi
npm run demo &
TWINLABS_PID=$!
trap 'kill "$TWINLABS_PID" 2>/dev/null' EXIT INT TERM
for ((i=0; i<30; i++)); do
  if curl --silent --fail http://localhost:5173/ >/dev/null; then open http://localhost:5173/; break; fi
  sleep 1
done
wait "$TWINLABS_PID"
