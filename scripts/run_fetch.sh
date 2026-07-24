#!/bin/bash
set -euo pipefail
ROOT="/Users/eduardooliveira/projects/options-dashboard"
# launchd runs with a minimal PATH; use uv's absolute path.
# Find yours with `command -v uv` (e.g. /opt/homebrew/bin/uv or ~/.local/bin/uv).
UV="/opt/homebrew/bin/uv"
cd "$ROOT/fetcher"
SPREADSHEET_ID="<paste-sheet-id>"
export SHEET_RANGE="Master"
export CREDENTIALS_PATH="$ROOT/fetcher/credentials.json"
export TOKEN_PATH="$ROOT/fetcher/token.json"
# `uv run` auto-syncs from uv.lock before executing, so the job self-heals if the env drifts.
exec "$UV" run --project "$ROOT/fetcher" python fetch_trades.py \
  "$SPREADSHEET_ID" "$ROOT/web/dist/trades.json"
