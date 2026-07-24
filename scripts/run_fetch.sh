#!/bin/bash
set -euo pipefail
ROOT="/Users/eduardooliveira/projects/options-dashboard"
# launchd runs with a minimal PATH; use uv's absolute path.
# Find yours with `command -v uv` (e.g. /opt/homebrew/bin/uv or ~/.local/bin/uv).
UV="/opt/homebrew/bin/uv"
cd "$ROOT/fetcher"
# Sheet ID, tab, and destination come from config.toml at the project root.
# `uv run` auto-syncs from uv.lock before executing, so the job self-heals if the env drifts.
exec "$UV" run --project "$ROOT/fetcher" python fetch_trades.py
