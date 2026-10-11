#!/usr/bin/env bash
# The check command: the gate in `scripts/validate`, then the browser tests.
set -euo pipefail
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/validate" --browser
