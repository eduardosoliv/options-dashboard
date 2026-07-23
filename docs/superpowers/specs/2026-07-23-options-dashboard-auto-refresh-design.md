# Options Dashboard — Auto-Refresh Design

**Date:** 2026-07-23
**Status:** Approved

## Problem

A rich React options-trading dashboard (~2,900-line component using recharts +
lucide) currently hardcodes its data as a `const TRADES = [...]` array. Updating
it means manually exporting a Google Sheet, pasting it into Claude, and having
Claude regenerate the array. The goal is to cut that manual loop: pull the one
Sheet automatically on a schedule and have the dashboard refresh itself, without
granting Claude (or any tool) access to the entire Drive.

The Sheet uses `GOOGLEFINANCE` to keep in-play quotes current, so periodic
refresh keeps risk buffers and estimated yields live. Closed trades are static.

## Goals

- Fetch **one** Google Sheet on a schedule (every 10 min) — no whole-Drive access.
- Dashboard updates itself every 10 min without a manual reload.
- Reuse the existing dashboard component essentially unchanged.
- Runs locally on macOS, unattended.

## Non-Goals

- No cloud hosting, multi-user, or auth for the dashboard itself (local only).
- No changes to the Sheet's own formulas or structure.
- No rewrite of the dashboard's charts/analytics — they stay as-is.

## Architecture — three decoupled pieces

```
Google Sheet (GOOGLEFINANCE)
        │  Sheets API (OAuth, spreadsheets.readonly, FORMATTED_VALUE)
        ▼
  fetch_trades.py  ──writes──▶  trades.json  ──served──▶  Dashboard (browser)
   (launchd, every 10 min)      (atomic write)  (static)   (re-fetch every 10 min)
```

### 1. Fetcher — `fetcher/fetch_trades.py`

- **Auth:** OAuth installed-app flow via `google-auth-oauthlib`. Scope
  `https://www.googleapis.com/auth/spreadsheets.readonly` (read-only, spreadsheets
  only — narrower than `drive.readonly`). User consents once in a browser; a
  refresh token is stored in `token.json` and renewed silently thereafter.
- **Read:** Sheets API `spreadsheets.values.get` with
  `valueRenderOption=FORMATTED_VALUE`, so cells arrive as the exact displayed
  strings (`$1,234.56`, `19.79%`, `✅ Very Safe`) — identical to the CSV export.
- **Transform** each data row into the trade-object shape (see mapping below).
- **Skip** non-data rows: the summary row (blank `Acquired`) and the stats block
  at the bottom (blank ticker).
- **Write** `trades.json` atomically: write to `trades.json.tmp`, then
  `os.replace()` to the final path, so the browser never reads a partial file.
- **Fail safe:** on any error (network, auth, parse), log and exit non-zero
  WITHOUT overwriting the existing `trades.json`. A stale-but-valid file beats a
  broken one.

### 2. Dashboard — existing component, minimal change

- Replace `const TRADES = [...]` with a `fetch('./trades.json')` into React state
  on mount.
- Add `setInterval(refetch, 600_000)` so an open tab updates itself every 10 min.
- Handle the empty/loading state (before first fetch resolves).
- Everything downstream (`getFilteredTrades`, `stats`, all charts, forecast,
  yield tables) is unchanged — it already reads only from the trades array.

### 3. Scheduling + hosting (macOS)

- **Build once:** `vite build` → `web/dist/` (static HTML/JS/CSS).
- **Serve:** a minimal static server (e.g. `python3 -m http.server` or `npx serve`)
  serving `web/dist/` on a fixed localhost port, kept alive by launchd.
- **Fetcher schedule:** a second launchd job runs `fetch_trades.py` every 600 s,
  writing `web/dist/trades.json` (the served location). The dashboard fetches
  `./trades.json` relative to itself.
- **launchd, not crontab:** survives sleep/wake and runs missed jobs on wake.
- After a rebuild (only when component code changes), run the fetcher once to
  repopulate `trades.json`; otherwise the next 10-min tick refills it.

## Data mapping (CSV/Sheet column → trade-object field)

Normalization lives entirely in the fetcher, so the JSON is clean and the JSX
needs no parsing logic.

| Sheet column | Field | Transform |
|---|---|---|
| Acquired, Expires, Closed On | `acquired`, `expires`, `closedOn` | string as-is; blank → `null` |
| **Days** (col 3) | `status` | `CLOSED`/`ASSIGNED`/`EXPIRED` → that value; a **number** → `IN PLAY` |
| # | `contracts` | int |
| Column 1 | `ticker` | string |
| Type | `type` | `Short Put` / `Covered Call` |
| Premium, Strike, Price, Risk Level, Capital, Gain/Loss | `premium`, `strike`, `price`, `riskLevel`, `capital`, `gainLoss` | strip `$` and `,` → float; blank → `null` |
| Buffer, Est. Annualized Yield, Real Yield | `buffer`, `estYield`, `realYield` | strip `%` → float; blank → `null` |
| Risk | `riskCategory` | strip leading emoji/space → `Very Safe`/`Safe`/`Alert`/`Danger`/`ITM`/`Deep ITM`; blank → `null` |
| Duration | `duration` | int |

Notes:
- The `Days` column double-duty (status text vs. a number) is the key parse rule:
  if it parses as a number, the trade is `IN PLAY`; otherwise it's the status.
- `riskCategory` strings must exactly match the JSX's expected set (no emoji),
  since the component keys colors/icons/forecast probabilities off them.

## Project structure

```
options-dashboard/
  fetcher/
    fetch_trades.py
    requirements.txt
    credentials.json        # OAuth client secret — gitignored
    token.json              # stored refresh token — gitignored
  web/
    index.html
    vite.config.js
    package.json
    src/
      main.jsx
      TradingDashboard.jsx  # existing component, data-loading swapped in
    dist/                   # vite build output; trades.json written here at runtime
  scripts/
    com.<user>.options-fetch.plist    # launchd: fetcher every 600s
    com.<user>.options-serve.plist    # launchd: static server, KeepAlive
  docs/superpowers/specs/…
  .gitignore                # credentials.json, token.json, node_modules, dist
```

## Error handling

- **Fetcher:** never overwrite a good `trades.json` on failure; log to a file
  launchd captures (`StandardErrorPath`). Non-zero exit on failure.
- **Dashboard:** if `trades.json` is missing or a fetch fails, keep showing the
  last successfully loaded data and surface a small "last updated / stale" note
  rather than blanking the UI.
- **Auth expiry:** refresh token renews automatically; if it is ever revoked,
  the fetcher logs a clear "re-run consent" message.

## Testing

- **Fetcher:** unit-test the row-normalizer against the sample CSV
  (`Short Puts and Covered Calls - Master (66).csv`) — assert the parsed objects
  match the shape/values the JSX expects, including the `Days`→status rule,
  emoji stripping, `$`/`%`/`,` parsing, and summary-row skipping. Test atomic
  write and the fail-without-clobber path.
- **Dashboard:** render with a fixture `trades.json` and confirm the component
  mounts and the interval re-fetch is wired.
- **End-to-end (manual):** run the fetcher against the real Sheet, `vite build`,
  serve, open the dashboard, confirm data matches and refresh works.

## Open items to resolve during implementation

- Spreadsheet ID + tab name/`gid` (from the Sheet URL).
- Fixed localhost port for the static server.
- The `<user>`/label for the launchd plist filenames.
```
