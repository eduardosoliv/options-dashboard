# AGENTS.md

Guidance for AI agents working in this repo. Human-facing setup/usage lives in
`README.md`; this file is the working contract for agents.

## What this is

An auto-refreshing dashboard for an options-selling book (short puts + covered
calls). A Python service pulls **one** Google Sheet on a schedule and writes
`trades.json`; a React dashboard renders it and re-fetches every 10 minutes.
Deliberately scoped so no tool ever gets access to the whole Google Drive —
only the one Sheet, read-only.

## Layout

```
fetcher/            Python service (managed with uv)
  normalize.py        pure Sheet-row → trade-object transforms
  assignments.py      pure AssignedCalled-tab → assignments.json parser (optional tab)
  fetch_trades.py     OAuth + Sheets read + atomic write + CLI entrypoint
  tests/              pytest (runs against a real sample CSV export)
web/                Vite + React 19 + Tailwind v4 app
  src/App.jsx              data loader: fetch + 10-min refresh + remount-on-change
  src/TradingDashboard.jsx VENDORED dashboard (see rules below) — takes `tradesData` + `updatedAt` (+ optional `benchmarks`, `assignments`) props
  src/data.js             trades.json + benchmarks.json fetch, djb2 content hash
  src/assignments.js       Assigned & Called: lots from trades + broker lots, $ vs S&P 500, covered calls, chart rows
  src/AssignmentsSection.jsx  Assigned & Called section (assumptions, boxes, multi-select line charts)
  src/*.test.*            vitest (loader unit test + jsdom render smoke test)
  trades-example.json      sample dataset for previewing without Google (see README)
config-example.toml template for `config.toml` (git-ignored): spreadsheet_id, sheet_range, output_path, optional [benchmarks]
docs/superpowers/   design specs & implementation plans
justfile            task runner — the canonical entrypoint for all commands
```

## Commands — use `just`

`just` is the task runner. Prefer it over raw commands; run `just --list` to see all.

| Command | Purpose |
|---------|---------|
| `just install` | install deps (uv sync + npm install) |
| `just test` | all tests (pytest + vitest) |
| `just lint` | ruff + ruff-format-check + biome (no writes, no type-checking) |
| `just fmt` | auto-format + auto-fix (ruff + biome) |
| `just typecheck` | mypy strict + tsc strict |
| `just check` | full gate: `lint` + `typecheck` + `test` — run this before claiming done |
| `just build` / `just serve` / `just dev` | web build / serve dist on :4173 / dev server |
| `just fetch` | run the fetcher once → `web/dist/trades.json` (reads `config.toml`) |
| `just hooks` | install the pre-commit git hooks (`.pre-commit-config.yaml`) |

Raw equivalents: `cd fetcher && uv run <ruff|mypy|pytest>`; `cd web && npm run <lint|typecheck|test|build>`.

## Toolchain conventions (do not deviate)

- **Python deps: uv only.** `pyproject.toml` + `uv.lock` (both committed). Never
  use `pip`, `requirements.txt`, or a hand-managed venv. Run via `uv run …`.
- **Task runner: `just`.** No Makefile.
- **Web lint/format: Biome.** No ESLint/Prettier.
- **Everything runs in strict mode** and `just check` must stay green:
  - ruff: `select = ["ALL"]` (a few opinion/formatter-conflict rules ignored in `pyproject.toml`)
  - mypy: `--strict`
  - TypeScript: `tsc --noEmit` with `strict` + `checkJs` over authored JS (JSDoc-typed)
  - Biome: all bug-catching groups enabled (`correctness`, `suspicious`, `security`, `complexity`, `performance`, `a11y`), not just recommended
- **Dependencies: latest majors, pinned major-only** (`^19`, `>=2`, not `^19.2.17`).
  This is an internal tool — favor staying current over conservative pinning.
- **Node ≥ 20.19** (Vite 8); `.nvmrc` pins 22.
- When a strict rule fires on genuinely-intentional code, use a scoped
  `biome-ignore` / `# noqa` / `# type: ignore[code]` **with a reason** — do not
  weaken the global config.

## The vendored component — `web/src/TradingDashboard.jsx`

~2,700 lines brought in verbatim from the user. Treat as vendored:

- It is `@ts-nocheck` and **excluded from Biome** (`!src/TradingDashboard.jsx` in
  `biome.json`). Strict tooling applies to code we author, not this file.
- **Do not reformat it or refactor its internals.** The only sanctioned edits so
  far: removing hardcoded data + dead code, and the `{ tradesData, updatedAt }`
  prop swap, plus the optional `benchmarks` and `assignments` props, and mounting
  the authored sections (`AssignmentsSection`, Equity Curve net cash via the
  exported `buildEquityCash`).
- It reads all trade data from `const TRADES = tradesData;` (first line of the
  component). `App.jsx` remounts it via `key={sig}` when data changes, so its
  many `useMemo(…, [])` hooks recompute — do not "fix" those empty deps.

## Data contract (fetcher ↔ dashboard)

The normalizer emits objects with EXACTLY these keys (camelCase); the dashboard
reads them directly, so keep them in sync:

```
acquired, expires, status, ticker, contracts, type, premium, strike, price,
buffer, riskLevel, riskCategory, duration, estYield, closedOn, gainLoss,
capital, realYield, exitPrice, premiumCollected, closeCost
```

Sheet-parsing rules that are easy to get wrong (`fetcher/normalize.py`):

- **`status`** comes from the sheet's `Days` column: a numeric value ⇒ `"IN PLAY"`;
  otherwise the literal (`CLOSED` / `ASSIGNED` / `EXPIRED` / `CALLED`).
- **`exitPrice` / `premiumCollected`** are parsed from the Gain/Loss *formula*
  (the fetcher reads the range twice: formatted values + `FORMULA`). ASSIGNED
  and CALLED rows use `=-(($E*100)*($I-<price>))+(<premium>)` (put) or
  `=-(($E*100)*(<price>-$I))+(<premium>)` (call). CLOSED rows written as
  `=(<premium>)-(<cost>)` yield `premiumCollected` + `closeCost`. Anything else
  (incl. the plain netted numbers on most CLOSED rows) ⇒ `None`.
- **Column 11/12 are swapped vs their headers**: the emoji risk *category* is in
  column 11, the dollar *risk level* in column 12 (`COL` follows the data, not
  the header labels).
- **`riskCategory`** must be emoji-free: one of `Very Safe, Safe, Alert, Danger,
  ITM, Deep ITM`.
- Summary rows (blank `Acquired` or blank ticker) are skipped; the sample CSV
  yields exactly 148 trades.
- Rows whose `Type` contains `call spread` (case-insensitive) are skipped —
  call spreads are tracked in the sheet but deliberately not imported.
- Money strips `$`/`,`; percent strips `%`; blanks become `None`.

### Benchmarks (`benchmarks.json`)

Optional `[benchmarks]` in `config.toml` (`put_return` = Cboe PutWrite Index,
`tbill_return` = T-bill rate on put collateral, both annualized %; `period` label) is written by the fetcher to `benchmarks.json` next to
`trades.json` as `{ putReturn, tbillReturn, period }` (each may be `null`).
`trades.json` stays a plain list. A bad table only warns — it never blocks the
trades fetch. The dashboard gets it as the `benchmarks` prop (no remount; it's
read in render, not in `useMemo`) and treats a 404 / non-JSON response as "not
configured".

### Assignments (`assignments.json`)

Optional Sheet tab **`AssignedCalled`** (`assignments_range` in `config.toml`
overrides the name), read with `UNFORMATTED_VALUE` + `SERIAL_NUMBER` dates:
columns A–F are broker lots (`Ticker | Acquired | Quantity | Cost basis | Sold on
| Proceeds`, totals; Sold on blank while held); from column H, rows labelled
`Key` (dashboard ticker, `SPX` for the S&P 500) / `Google symbol` / `Prices`
head one `GOOGLEFINANCE` Date/Close column pair per ticker. The fetcher writes
`{ asOf, held, sold, series: {KEY: [[iso, close]]} }` next to `trades.json`
after a successful trades fetch. A missing tab (HTTP 400) or malformed tab only
warns and leaves any existing file untouched — it never fails the fetch. The
dashboard gets it as the `assignments` prop (loaded like benchmarks: 404 /
non-JSON / wrong shape ⇒ null, last good value kept on errors) and shows a
setup hint instead of the charts when it's null. Broker lots are matched to
trades by expected per-share price (strike ∓ premium per share), never on the
wrong side of the strike, each lot used once.

## Invariants — don't break these

- **Fail-safe fetch:** `fetch_trades.py` must never overwrite a good
  `trades.json` on error or empty result (stale-but-valid beats broken). `main()`
  catches all exceptions and returns non-zero; `write_trades` refuses empty input.
- **Dashboard resilience:** `App.jsx` keeps the last good data on a failed fetch;
  don't clear state on error.
- **OAuth scope is exactly** `https://www.googleapis.com/auth/spreadsheets.readonly`
  — never add `drive.*` scopes.
- **Personal position data stays out of git:** the repo is public. Real lots and
  prices live only in the Sheet and the gitignored `assignments.json`; test
  fixtures use made-up tickers and numbers, never real ones.
- **Secrets stay out of git:** `fetcher/credentials.json`, `fetcher/token.json`,
  and `config.toml` are gitignored. Never commit them, `.venv/`, `node_modules/`,
  `dist/`, `trades.json`, or `assignments.json`. Check `git status` before committing.
- The Sheet tab is named **`Master`** (default `sheet_range` in `config.toml`);
  in-play quotes are live via `GOOGLEFINANCE`, which is why the 10-min refresh
  matters.

## Testing

- Fetcher: `pytest` — the normalizer is tested against the real sample export
  (`fetcher/tests/fixtures/sample_master.csv`).
- Web: `vitest` — `data.test.js` (loader) and `TradingDashboard.test.jsx` (jsdom
  render smoke test that mounts the full dashboard with a fixture). The render
  test guards against breakage on dependency upgrades; jsdom can't lay out SVG
  charts, so it verifies *mount*, not visual layout — a human should eyeball the
  live dashboard after major UI/recharts changes. `App.test.jsx` drives `App`
  with a mocked `fetch` (trades + benchmarks loading); `web/vite.config.test.js`
  covers the dev-server middleware that serves `dist/trades.json` and
  `dist/benchmarks.json` / `dist/assignments.json` during `just dev` (every fetcher output file must be
  listed there, or dev falls back to `index.html`).
- After any change, run `just check` and confirm it's green before reporting done.

## Git workflow

- **Don't commit directly to `main` for non-trivial work.** Branch, commit in
  focused logical commits, then merge with `git merge --no-ff` and delete the
  branch. Re-run `just check` on the merged result.
- Only commit/push when asked.

## Steps agents can't do (need the human)

- First-time Google OAuth: needs the user's `fetcher/credentials.json` and an
  interactive browser consent. Build `web/dist/` first (the fetcher writes into it).
- Creating `config.toml`: needs the user's real spreadsheet ID (copy
  `config-example.toml` and fill it in).
