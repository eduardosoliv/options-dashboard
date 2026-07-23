# Options Dashboard

Auto-refreshing options-trading dashboard fed from one Google Sheet.

## One-time setup
1. Google Cloud Console: enable the **Google Sheets API**, create an OAuth
   **Desktop app** client, download it to `fetcher/credentials.json`.
2. `cd fetcher && uv sync` (creates the environment from `uv.lock`; optional —
   `uv run` also syncs on demand).
3. `cd web && npm install && npm run build` (creates `web/dist/`, which the
   next step writes into).
4. First consent (opens a browser once), run from `fetcher/`:
   `SPREADSHEET_ID="<id>" OUTPUT_PATH="../web/dist/trades.json" uv run python fetch_trades.py`
5. Put your Sheet ID into `scripts/run_fetch.sh` (SPREADSHEET_ID).

## Run it (launchd)
```bash
cp scripts/net.eduardooliveira.options-*.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/net.eduardooliveira.options-serve.plist
launchctl load ~/Library/LaunchAgents/net.eduardooliveira.options-fetch.plist
open http://localhost:4173
```

The fetcher runs every 10 min (`fetch.log` / `fetch.err.log`); the dashboard
tab re-fetches every 10 min on its own.

## After changing the dashboard code
`cd web && npm run build`, then run the fetcher once (or wait 10 min) to
repopulate `dist/trades.json`.

## Stop it
```bash
launchctl unload ~/Library/LaunchAgents/net.eduardooliveira.options-fetch.plist
launchctl unload ~/Library/LaunchAgents/net.eduardooliveira.options-serve.plist
```
