#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 24 || (major === 24 && minor < 15)) {
    console.error("Lunar Base requires Node.js 24.15 or newer.");
    process.exit(1);
  }
'

lock_sha256=$(node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  console.log(createHash("sha256").update(readFileSync("package-lock.json")).digest("hex"));
')

if [[ ! -d node_modules || ! -f node_modules/.lock-sha256 || $(<node_modules/.lock-sha256) != "$lock_sha256" ]]; then
  npm ci
  printf '%s\n' "$lock_sha256" > node_modules/.lock-sha256
fi

# `--prepare` stops here: the check command installs before Playwright starts,
# so `npm start` under the browser tests never reinstalls under a running test.
if [[ ${1:-} == --prepare ]]; then
  exit 0
fi

./node_modules/.bin/vite build
exec node src/server/main.ts
