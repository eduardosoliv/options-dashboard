# Fetch diff summary — design

## Problem

`just fetch` reports only `OK: wrote 148 trades to …`. It gives no sense of
what actually changed versus the previous `trades.json`: new positions opened,
positions closed/expired/assigned, or rows removed from the sheet. Price/live
fields churn on every fetch (`GOOGLEFINANCE` quotes) and must NOT be reported as
changes.

## Goal

After a successful fetch, print a short summary of meaningful changes since the
previous `trades.json`:

- **Added** — positions in the new data absent from the old file.
- **Removed** — positions in the old file absent from the new data.
- **Status changes** — matched positions whose `status` flipped
  (e.g. `IN PLAY → CLOSED / EXPIRED / ASSIGNED`).

Price/live fields never count as changes.

## Non-goals

- Reporting `price`, `buffer`, `riskLevel`, `estYield`, `duration` changes.
- Reporting `gainLoss` / `realYield` / `closedOn` changes on their own (only
  surfaced implicitly via a `status` change).
- Persisting history beyond the current `trades.json` on disk.

## Approach

New pure module `fetcher/diff.py` holding all comparison + formatting logic;
`fetch_trades.py` gains thin IO wiring only. This mirrors the existing split
(pure transforms in `normalize.py`, OAuth/IO in `fetch_trades.py`) and keeps the
diff fully unit-testable with no filesystem or mocking.

Rejected alternatives: folding into `normalize.py` (mixes "row→trade" with
"list→list" concerns); inlining in `main()` (untestable, clutters the IO path).

## `fetcher/diff.py` (pure)

- **Match key** = `(acquired, expires, ticker, type, strike, contracts)` — the
  fields fixed when a position opens. All live/price/realized fields are excluded
  from the key and never compared, so recurring quote churn stays silent.
- Duplicate match-keys (same ticker/strike/expiry/contracts opened the same day)
  are paired by **occurrence index**, so add/remove counts stay exact when a
  position has multiple identical lots.
- `diff_trades(old, new) -> TradesDiff` dataclass:
  - `added: list[Trade]`
  - `removed: list[Trade]`
  - `status_changes: list[tuple[str | None, Trade]]` — `(old_status, new_trade)`
    for matched keys whose `status` differs.
- `format_summary(diff) -> str` — the printable block:
  - A trade renders as `TICKER {strike}{P|C} exp {expires}`, e.g.
    `JPM 280P exp Jan 16, 26`. Strike drops a trailing `.0`; `Short Put`→`P`,
    `Covered Call`→`C` (unknown types fall back to the raw label).
  - `expires` is kept verbatim from the sheet (`Jul 18, 25`), not reformatted.
  - Status changes group by **new** status: `~N closed:` / `~N expired:` /
    `~N assigned:` (lowercased new status).
  - Each list caps at 10 items, then `… (+N more)`.
  - No changes → `No changes since last fetch.`

## `fetch_trades.py` wiring

- `read_existing_trades(path) -> list[Trade]` — reads the current `trades.json`
  *before* overwrite. Returns `[]` on missing/unreadable/invalid JSON; never
  raises, never blocks the fetch (fail-safe invariant preserved).
- In `main()`, capture `old = read_existing_trades(output_path)` before
  `write_trades`, then after the `OK:` line print `format_summary(diff_trades(old, trades))`.
- No previous file (empty `old`) → summary reads `(baseline: no previous trades.json)`.

Example output:

```
OK: wrote 148 trades to /…/web/dist/trades.json
  +2 new:     AAPL 180P exp Aug 15, 25, MSFT 400C exp Sep 19, 25
  ~1 closed:  TSLA 250P exp Jul 18, 25
  -1 removed: FOO 10P exp Jul 18, 25
```

## Testing

`fetcher/tests/test_diff.py` (pure, no filesystem):

- **added / removed / status-change** detection (incl. `→ EXPIRED`, `→ ASSIGNED`).
- **price churn ignored** — identical keys, only `price`/`buffer`/`riskLevel`/
  `estYield`/`duration` differ → all-empty diff (encodes the core requirement).
- **realized fields ignored** — `gainLoss`/`realYield`/`closedOn` change without a
  status change → no report.
- **duplicate keys** — adding a 3rd identical-key lot → exactly one `added`;
  removing one → exactly one `removed`.
- **empty baseline** — `diff_trades([], new)` reports every trade as added, none
  removed.
- **formatting** — trade label (strike `.0` stripped, P/C abbreviation), status
  grouping buckets, truncation at 10 with `… (+N more)`, and the
  `No changes since last fetch.` case.

`read_existing_trades()` gets one filesystem test using pytest's `tmp_path`
(missing file and garbage file both return `[]`) — no mocking.

`just check` (ruff ALL + mypy strict + tests) must stay green.
