# Options Dashboard

A self-refreshing dashboard for an options-selling book (short puts + covered
calls). A small Python service pulls one Google Sheet on a schedule and writes
`trades.json`; a React dashboard renders it and re-fetches every 10 minutes. No
tool ever gets access to your whole Google Drive — only the one Sheet you share.

## How it works

```
Google Sheet (GOOGLEFINANCE keeps in-play quotes live)
        │  Sheets API — OAuth, scope: spreadsheets.readonly, FORMATTED_VALUE
        ▼
  fetcher/fetch_trades.py ──writes──▶ web/dist/trades.json ──served──▶ dashboard
   (launchd, every 10 min)             (atomic write)        (static)   (re-fetch/10 min)
```

Three decoupled parts:

- **`fetcher/`** — Python (managed with [uv](https://docs.astral.sh/uv/)). Reads
  the Sheet via OAuth, normalizes rows into trade objects, writes `trades.json`
  atomically. It never overwrites a good file on error, so a stale-but-valid
  dashboard beats a broken one.
- **`web/`** — Vite + React + Tailwind v4. Loads `trades.json` on mount and every
  10 minutes; the analytics/charts recompute from that data.
- **`scripts/`** — two macOS launchd jobs: one runs the fetcher on a 10-minute
  interval, one serves the built app on `http://localhost:4173`.

## Prerequisites

| Tool | Why | Install |
|------|-----|---------|
| [uv](https://docs.astral.sh/uv/) | Python env + deps for the fetcher | `brew install uv` |
| Node ≥ 20 | Build/run the web app (`.nvmrc` pins 22) | `brew install node` or `nvm use` |
| [just](https://github.com/casey/just) | Task runner (optional but convenient) | `brew install just` |
| [pre-commit](https://pre-commit.com/) | Git hooks (optional) | `pipx install pre-commit` |

## Project layout

```
fetcher/            Python fetcher (uv)
  normalize.py        pure Sheet-row → trade-object transforms
  fetch_trades.py     OAuth + Sheets read + atomic write + CLI entrypoint
  tests/              pytest suite (run against a real sample export)
web/                Vite + React + Tailwind app
  src/App.jsx         data loader (fetch + 10-min refresh + remount-on-change)
  src/TradingDashboard.jsx   the dashboard (reads a tradesData prop)
  src/data.js         trades.json fetch + content hash
scripts/            run_fetch.sh + two launchd .plist files
justfile            task runner (just --list)
```

## One-time setup

1. **Google Cloud:** enable the **Google Sheets API**, create an OAuth
   **Desktop app** client, and download it to `fetcher/credentials.json`.
2. **Share the Sheet** with your own Google account (it already is) — the OAuth
   scope is read-only and limited to Sheets.
3. **Install dependencies:** `just install` (or `cd fetcher && uv sync` and
   `cd web && npm install`).
4. **Build the web app** (creates `web/dist/`, which the fetcher writes into):
   `just build`.
5. **First OAuth consent** (opens a browser once), from `fetcher/`:
   ```bash
   SPREADSHEET_ID="<your-sheet-id>" OUTPUT_PATH="../web/dist/trades.json" \
     uv run python fetch_trades.py
   ```
   You should see `OK: wrote N trades …` and a new `fetcher/token.json`.
6. **Wire the scheduler:** put your Sheet ID into `scripts/run_fetch.sh`
   (`SPREADSHEET_ID`).

> The Sheet's tab must be named **`Master`** (the default `SHEET_RANGE`). If
> yours differs, set `SHEET_RANGE` accordingly.

## Everyday commands

All via `just` (run `just --list` to see them):

| Command | What it does |
|---------|--------------|
| `just dev` | Web app in dev mode with hot reload (`http://localhost:5173`) |
| `just build` | Build the web app to `web/dist/` |
| `just serve` | Serve the built app on `http://localhost:4173` |
| `just fetch` | Run the fetcher once → `web/dist/trades.json` (needs Sheet ID) |
| `just test` | Run all tests (pytest + vitest) |
| `just lint` | Lint + type-check everything, no writes (ruff, mypy, biome) |
| `just fmt` | Auto-format + auto-fix everything (ruff + biome) |
| `just typecheck` | mypy (strict) on the fetcher |
| `just check` | Full gate: `lint` then `test` |
| `just hooks` | Install the git pre-commit hooks |

Prefer the raw tools? `cd fetcher && uv run pytest` / `uv run ruff check` /
`uv run mypy .`; `cd web && npm test` / `npm run lint` / `npm run format`.

## Tooling

- **Python:** [ruff](https://docs.astral.sh/ruff/) (lint + format) and
  [mypy](https://mypy-lang.org/) in `--strict` mode. Config in
  `fetcher/pyproject.toml`.
- **Web:** [Biome](https://biomejs.dev/) (lint + format), config in
  `web/biome.json`. The vendored `TradingDashboard.jsx` is linted for dead code
  but intentionally not reformatted, and a few style/hook-dependency rules that
  conflict with its `key`-based remount design are disabled for that file.
- **Pre-commit:** `.pre-commit-config.yaml` runs ruff, mypy, and Biome on staged
  files via the project's own pinned tool versions. Enable with `just hooks`.

## Run it on a schedule (launchd)

```bash
cp scripts/net.eduardooliveira.options-*.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/net.eduardooliveira.options-serve.plist
launchctl load ~/Library/LaunchAgents/net.eduardooliveira.options-fetch.plist
open http://localhost:4173
```

The fetcher runs every 10 minutes (logs at `fetch.log` / `fetch.err.log`); the
open dashboard tab re-fetches every 10 minutes on its own.

**After changing the dashboard code:** `just build`, then `just fetch` once (or
wait for the next tick) to repopulate `web/dist/trades.json`.

**Stop it:**

```bash
launchctl unload ~/Library/LaunchAgents/net.eduardooliveira.options-fetch.plist
launchctl unload ~/Library/LaunchAgents/net.eduardooliveira.options-serve.plist
```

## Troubleshooting

- **Dashboard shows "Could not load trades.json":** the fetcher hasn't produced
  `web/dist/trades.json` yet. Run `just fetch` (after `just build`), or check
  `fetch.err.log`.
- **Browser consent re-appears / token errors:** delete `fetcher/token.json` and
  re-run the step-5 consent command.
- **`launchctl` fetch job fails silently:** it needs `SPREADSHEET_ID` set in
  `scripts/run_fetch.sh` and a valid `fetcher/credentials.json` +
  `fetcher/token.json`. launchd uses a minimal PATH, which is why the script
  calls `uv` by absolute path.
- **Empty/zero trades:** the fetcher refuses to overwrite with an empty result,
  so the last good `trades.json` stays in place; check that the tab name matches
  `SHEET_RANGE`.
