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
  fetch_trades.py     OAuth + Sheets read + atomic write + CLI entrypoint
  tests/              pytest (runs against a real sample CSV export)
web/                Vite + React 19 + Tailwind v4 app
  src/App.jsx              data loader: fetch + 10-min refresh + remount-on-change
  src/TradingDashboard.jsx VENDORED dashboard (see rules below) — reads a `tradesData` prop
  src/data.js             trades.json fetch + djb2 content hash
  src/*.test.*            vitest (loader unit test + jsdom render smoke test)
scripts/            run_fetch.sh + two launchd .plist files
docs/superpowers/   design specs & implementation plans
justfile            task runner — the canonical entrypoint for all commands
```

## Commands — use `just`

`just` is the task runner. Prefer it over raw commands; run `just --list` to see all.

| Command | Purpose |
|---------|---------|
| `just install` | install deps (uv sync + npm install) |
| `just test` | all tests (pytest + vitest) |
| `just lint` | ruff + ruff-format-check + mypy + biome + tsc (no writes) |
| `just fmt` | auto-format + auto-fix (ruff + biome) |
| `just typecheck` | mypy strict + tsc strict |
| `just check` | full gate: `lint` then `test` — run this before claiming done |
| `just build` / `just serve` / `just dev` | web build / serve dist on :4173 / dev server |
| `just fetch` | run the fetcher once → `web/dist/trades.json` |

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
  far: removing hardcoded data + dead code, and the `{ tradesData }` prop swap.
- It reads all trade data from `const TRADES = tradesData;` (first line of the
  component). `App.jsx` remounts it via `key={sig}` when data changes, so its
  many `useMemo(…, [])` hooks recompute — do not "fix" those empty deps.

## Data contract (fetcher ↔ dashboard)

The normalizer emits objects with EXACTLY these keys (camelCase); the dashboard
reads them directly, so keep them in sync:

```
acquired, expires, status, ticker, contracts, type, premium, strike, price,
buffer, riskLevel, riskCategory, duration, estYield, closedOn, gainLoss,
capital, realYield
```

Sheet-parsing rules that are easy to get wrong (`fetcher/normalize.py`):

- **`status`** comes from the sheet's `Days` column: a numeric value ⇒ `"IN PLAY"`;
  otherwise the literal (`CLOSED` / `ASSIGNED` / `EXPIRED`).
- **Column 11/12 are swapped vs their headers**: the emoji risk *category* is in
  column 11, the dollar *risk level* in column 12 (`COL` follows the data, not
  the header labels).
- **`riskCategory`** must be emoji-free: one of `Very Safe, Safe, Alert, Danger,
  ITM, Deep ITM`.
- Summary rows (blank `Acquired` or blank ticker) are skipped; the sample CSV
  yields exactly 148 trades.
- Money strips `$`/`,`; percent strips `%`; blanks become `None`.

## Invariants — don't break these

- **Fail-safe fetch:** `fetch_trades.py` must never overwrite a good
  `trades.json` on error or empty result (stale-but-valid beats broken). `main()`
  catches all exceptions and returns non-zero; `write_trades` refuses empty input.
- **Dashboard resilience:** `App.jsx` keeps the last good data on a failed fetch;
  don't clear state on error.
- **OAuth scope is exactly** `https://www.googleapis.com/auth/spreadsheets.readonly`
  — never add `drive.*` scopes.
- **Secrets stay out of git:** `fetcher/credentials.json`, `fetcher/token.json`
  are gitignored. Never commit them, `.venv/`, `node_modules/`, `dist/`, or
  `trades.json`. Check `git status` before committing.
- The Sheet tab is named **`Master`** (default `SHEET_RANGE`); in-play quotes are
  live via `GOOGLEFINANCE`, which is why the 10-min refresh matters.

## Testing

- Fetcher: `pytest` — the normalizer is tested against the real sample export
  (`fetcher/tests/fixtures/sample_master.csv`).
- Web: `vitest` — `data.test.js` (loader) and `TradingDashboard.test.jsx` (jsdom
  render smoke test that mounts the full dashboard with a fixture). The render
  test guards against breakage on dependency upgrades; jsdom can't lay out SVG
  charts, so it verifies *mount*, not visual layout — a human should eyeball the
  live dashboard after major UI/recharts changes.
- After any change, run `just check` and confirm it's green before reporting done.

## Git workflow

- **Don't commit directly to `master` for non-trivial work.** Branch, commit in
  focused logical commits, then merge with `git merge --no-ff` and delete the
  branch. Re-run `just check` on the merged result.
- Only commit/push when asked.

## Two steps agents can't do (need the human)

- First-time Google OAuth: needs the user's `fetcher/credentials.json` and an
  interactive browser consent. Build `web/dist/` first (the fetcher writes into it).
- Loading the launchd jobs: modifies the user's system; leave it to them.
