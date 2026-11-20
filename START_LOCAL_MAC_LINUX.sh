#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null; then echo 'Install Node.js 20+ at https://nodejs.org'; exit 1; fi
if [ -z "${APP_PASSWORD:-}" ]; then
  read -r -s -p 'Create a local shared access password: ' APP_PASSWORD
  echo
  export APP_PASSWORD
fi
if [ -z "${APP_PASSWORD:-}" ]; then echo 'Password required (or run node server.js for loopback-only preview).'; exit 1; fi
exec node server.js
