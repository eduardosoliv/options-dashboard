# Options Dashboard

A self-refreshing dashboard for an options-selling book (short puts + covered
calls). A small Python service pulls one Google Sheet on a schedule and writes
`trades.json`; a React dashboard renders it and re-fetches every 10 minutes. No
tool ever gets access to your whole Google Drive — only the one Sheet you share.

An example of the dashboard overview:

![Options Dashboard overview — portfolio stats, equity curve, and in-play risk](docs/dashboard-example1.png)

## How it works

```
Google Sheet (GOOGLEFINANCE keeps in-play quotes live)
        │  Sheets API — OAuth, scope: spreadsheets.readonly, FORMATTED_VALUE
        ▼
  fetcher/fetch_trades.py ──writes──▶ web/dist/trades.json ──served──▶ dashboard
   (run on a schedule)                 (atomic write)        (static)   (re-fetch/10 min)
```

Two decoupled parts:

- **`fetcher/`** — Python (managed with [uv](https://docs.astral.sh/uv/)). Reads
  the Sheet via OAuth, normalizes rows into trade objects, writes `trades.json`
  atomically. It never overwrites a good file on error, so a stale-but-valid
  dashboard beats a broken one.
- **`web/`** — Vite + React + Tailwind v4. Loads `trades.json` on mount and every
  10 minutes; the analytics/charts recompute from that data.

To keep the dashboard fresh, run `just fetch` on a schedule with whatever your
platform provides — cron, a systemd timer, macOS launchd, Windows Task
Scheduler, etc. — and serve the built `web/dist/` with any static file server
(`just serve` works for a quick local run).

## Prerequisites

| Tool | Why | Install |
|------|-----|---------|
| [uv](https://docs.astral.sh/uv/) | Python env + deps for the fetcher | `brew install uv` |
| Node ≥ 20.19 | Build/run the web app — Vite 8 (`.nvmrc` pins 22) | `brew install node` or `nvm use` |
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
  trades-example.json sample data — copy to dist/trades.json to preview
config-example.toml template for config.toml (git-ignored): Sheet ID + options
justfile            task runner (just --list)
```

## Try it with sample data

Want to see the dashboard before wiring up Google Sheets? A tiny example dataset
(`web/trades-example.json` — the six trades documented below) ships in the repo.
Copy it into place and run the app:

```bash
just install                                   # install deps
just build                                     # build web/dist/
cp web/trades-example.json web/dist/trades.json
just dev                                        # then open the printed URL
```

That's the whole preview — no Google account, OAuth, or fetcher needed. When
you're ready for live data, follow the setup below (a real fetch overwrites the
sample file).

## One-time setup

1. **Google Cloud:** enable the **Google Sheets API**, then configure the
   **OAuth consent screen** (User type **External**, add the read-only Sheets
   scope, and add your own Google account under **Test users** — the app stays
   in "Testing" mode, so only listed test users can authorize).
2. **OAuth client:** create an OAuth **Desktop app** client and download it to
   `fetcher/credentials.json`.
3. **Sheet access:** the Google account you authorize in step 7 must be able to
   read the Sheet — if it's your own Sheet, it already can; otherwise have the
   owner share it with you. The OAuth scope is read-only and limited to Sheets.
4. **Install dependencies:** `just install` (or `cd fetcher && uv sync` and
   `cd web && npm install`).
5. **Build the web app** (creates `web/dist/`, which the fetcher writes into):
   `just build`.
6. **Configure the fetch:** copy `config-example.toml` to `config.toml` at the
   project root and set your `spreadsheet_id`. `config.toml` is git-ignored.
7. **First OAuth consent** (opens a browser once), from `fetcher/`:
   ```bash
   uv run python fetch_trades.py
   ```
   It reads `config.toml`, so no arguments are needed. A browser tab opens for
   you to pick your Google account and grant read-only Sheets access. Because
   the app is unverified, Google warns "Google hasn't verified this app" —
   click **Advanced → Go to … (unsafe)** to continue (safe: it's your own
   client). You should then see `OK: wrote N trades …` and a new
   `fetcher/token.json` (the stored refresh token, so this consent is one-time).

> The Sheet's tab must be named **`Master`** (the default `sheet_range` in
> `config.toml`). If yours differs, set `sheet_range` accordingly.

## The Master sheet layout

The fetcher reads the tab **by column position**, not by header name — so the
**order and count of columns must match the table below**, but you can call the
headers whatever you like. The **first row is skipped** (treated as headers).

A row only counts as a trade if it has **both an Acquired date (A) and a Ticker
(F)**; rows missing either (blank rows, subtotals, summary lines) are ignored.

| Col | Field | Example | Format / notes |
|-----|-------|---------|----------------|
| A | Acquired | `Dec 16, 25` | Open date. **Required.** Free-form text (shown as-is). |
| B | Expires | `Jan 16, 26` | Expiration date. |
| C | Days / Status | `12` or `CLOSED` | A **number** ⇒ open (status "IN PLAY"); any **text** (e.g. `CLOSED`, `ASSIGNED`, `EXPIRED`) is used verbatim as the status. |
| D | Position | — | **Not used** — kept only to preserve column order. |
| E | Contracts | `2` | Integer. |
| F | Ticker | `JPM` | Symbol. **Required.** |
| G | Type | `Short Put` | Drives the ledger split — use `Short Put` or `Covered Call`. |
| H | Premium | `$266.62` | `$` and commas are stripped. |
| I | Strike | `$280` | Money. |
| J | Current Price | `$284.10` | Money; blank for closed trades (shown as `—`). Use `=GOOGLEFINANCE($F2)` to keep it live for open positions. |
| K | Buffer % | `8.5%` | `%` is stripped. |
| L | Buffer Level | `🟢 Safe` | One of six categories (see [Buffer levels](#buffer-levels)); a leading emoji is stripped (`🟢 Safe` → `Safe`). |
| M | Notional Risk | `$56,000` | Money — max notional on the position. |
| N | Duration | `31` | Integer (days). |
| O | Est. Yield | `6.2%` | Percent — estimated annualized yield. |
| P | Closed On | `Jan 10, 26` | Date; blank while open. |
| Q | Gain / Loss | `$266.62` | Realized P&L; positive = win, negative = loss. |
| R | Capital | `$56,000` | Money. |
| S | Real Yield | `5.9%` | Percent — realized annualized yield. |

Money cells may include `$` and thousands separators; percent cells may include
`%` — both are parsed leniently. Blank cells become empty/`null` and render as
`—`.

### Buffer levels

The dashboard keys its buffer filter, sorting, colors, and risk-scenario
probabilities off column L, so — **after the emoji is stripped** — the label must
be exactly one of these six:

| Label | Buffer (K) | Meaning |
|-------|-----------|---------|
| `Very Safe` | `> 20%` | Far out of the money |
| `Safe` | `10–20%` | Comfortable cushion |
| `Alert` | `5–10%` | Getting close |
| `Danger` | `0–5%` | Near the strike |
| `ITM` | `-5–0%` | In the money |
| `Deep ITM` | `< -5%` | Well in the money |

The **thresholds are yours to choose** — only the six label names are fixed.
These are the cutoffs I use (column K holds the buffer as a decimal, e.g. `0.2`
= 20%), computed in the sheet so column L stays in sync automatically:

```
=IF($K2="","",IF($K2>0.2,"✅ Very Safe",IF($K2>0.1,"🟢 Safe",IF($K2>0.05,"⚠️ Alert",IF($K2>0,"❗ Danger",IF($K2>-0.05,"🔴 ITM","🔴 Deep ITM"))))))
```

### Example rows

Six real trades covering both types and all four statuses. Note how **open**
positions (numeric column C) carry live columns (Price, Buffer, Level, Est.
Yield) while the closed columns are blank, and **closed/assigned/expired** rows
are the reverse. Column D (Position) is left blank since it's ignored.

| A Acquired | B Expires | C Days/Status | D Position | E Contracts | F Ticker | G Type | H Premium | I Strike | J Price | K Buffer | L Level | M Notional | N Duration | O Est. Yield | P Closed On | Q Gain/Loss | R Capital | S Real Yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| May 27, 26 | Aug 21, 26 | 29 | | 2 | KKR | Short Put | $268.65 | $75 | $95.97 | 21.85% | ✅ Very Safe | $15,000 | 86 | 7.6% | | | | |
| Jun 11, 26 | Jul 31, 26 | 8 | | 1 | AMZN | Covered Call | $224.33 | $280 | $233.66 | 19.83% | 🟢 Safe | | 50 | | | | | |
| Dec 16, 25 | Jan 16, 26 | CLOSED | | 2 | JPM | Short Put | | $280 | | | | | 31 | | Jan 13, 26 | +$266.62 | $56,000 | 6.21% |
| Dec 16, 25 | Feb 20, 26 | CLOSED | | 1 | GOOGL | Covered Call | | $365 | | | | | 66 | | Feb 11, 26 | +$301.32 | | |
| Nov 17, 25 | Feb 20, 26 | ASSIGNED | | 1 | MSFT | Short Put | | $435 | | | | | 95 | | Feb 20, 26 | -$3,201.67 | $43,500 | |
| Jan 13, 26 | Feb 20, 26 | EXPIRED | | 2 | MRSH | Short Put | | $165 | | | | | 38 | | Feb 20, 26 | +$238.65 | $33,000 | 6.95% |

## Everyday commands

All via `just` (run `just --list` to see them):

| Command | What it does |
|---------|--------------|
| `just dev` | Web app in dev mode with hot reload (`http://localhost:5173`) |
| `just build` | Build the web app to `web/dist/` |
| `just serve` | Serve the built app on `http://localhost:4173` |
| `just fetch` | Run the fetcher once → `web/dist/trades.json` (reads `config.toml`) |
| `just test` | Run all tests (pytest + vitest) |
| `just lint` | Lint everything, no writes (ruff, biome) — no type-checking |
| `just fmt` | Auto-format + auto-fix everything (ruff + biome) |
| `just typecheck` | mypy (strict) + tsc (strict) |
| `just check` | Full gate: `lint` + `typecheck` + `test` |
| `just hooks` | Install the git pre-commit hooks |

Prefer the raw tools? `cd fetcher && uv run pytest` / `uv run ruff check` /
`uv run mypy .`; `cd web && npm test` / `npm run lint` / `npm run format`.

**After changing the dashboard code:** `just build`, then `just fetch` once to
repopulate `web/dist/trades.json`.

## Tooling

All type-checkers and linters run in **strict** mode:

- **Python:** [ruff](https://docs.astral.sh/ruff/) with the full ruleset
  (`select = ["ALL"]`, a few opinion/formatter-conflict rules ignored) plus
  [mypy](https://mypy-lang.org/) `--strict`. Config in `fetcher/pyproject.toml`.
- **Web:** [Biome](https://biomejs.dev/) (lint + format) in a strict posture —
  every bug-catching rule group (`correctness`, `suspicious`, `security`,
  `complexity`, `performance`, `a11y`) enabled in full, not just the recommended
  subset (`web/biome.json`). Plus strict
  [TypeScript](https://www.typescriptlang.org/) via `tsc --noEmit` with
  `strict` + `checkJs` — our authored JS (`App.jsx`, `data.js`, `main.jsx`) is
  type-checked with JSDoc annotations (`tsconfig.json`).
- **Vendored component:** `src/TradingDashboard.jsx` is a large, untyped
  third-party component. It's excluded from Biome and marked `@ts-nocheck`, so
  strict tooling applies to the code we author, not the vendored file. (Its dead
  code was already removed when it was brought in.)
- **Web tests:** Vitest — `data.test.js` covers the loader, and
  `TradingDashboard.test.jsx` is a jsdom render smoke test that mounts the full
  dashboard with fixture data (guards against breakage on dependency upgrades).
  Dependencies track the latest majors and are pinned major-only (e.g. `^19`).
- **Pre-commit:** `.pre-commit-config.yaml` runs ruff, mypy, and Biome on staged
  files via the project's own pinned tool versions. Enable with `just hooks`.

## Troubleshooting

- **Dashboard shows "Could not load trades.json":** the fetcher hasn't produced
  `web/dist/trades.json` yet. Run `just fetch` (after `just build`) and check its
  output — if you run it on a schedule, look at wherever that scheduler logs stderr.
- **Browser consent re-appears / token errors:** delete `fetcher/token.json` and
  re-run the step-7 consent command.
- **`just fetch` fails silently:** it needs a valid `config.toml` at the project
  root plus `fetcher/credentials.json` + `fetcher/token.json`; check the fetcher's
  stderr output.
- **Empty/zero trades:** the fetcher refuses to overwrite with an empty result,
  so the last good `trades.json` stays in place; check that the tab name matches
  `sheet_range` in `config.toml`.
