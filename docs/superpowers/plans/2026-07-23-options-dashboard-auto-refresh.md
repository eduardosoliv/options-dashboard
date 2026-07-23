# Options Dashboard Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hardcoded-data options dashboard into one that auto-refreshes from a single Google Sheet every 10 minutes on macOS, without granting whole-Drive access.

**Architecture:** A Python fetcher authenticates to Google via OAuth (`spreadsheets.readonly`), reads the one Sheet with `FORMATTED_VALUE`, normalizes rows into trade objects, and atomically writes `trades.json`. The existing React/Vite dashboard fetches `trades.json` on mount and every 10 min, remounting only when the data actually changes. Two launchd jobs run the fetcher on an interval and keep a static server serving the built app.

**Tech Stack:** Python 3 managed with `uv` (`google-api-python-client`, `google-auth-oauthlib`, `pytest`); React 18 + Vite 5 + Tailwind CSS v4 + recharts + lucide-react + vitest; macOS launchd.

## Global Constraints

- OAuth scope is exactly `https://www.googleapis.com/auth/spreadsheets.readonly` — read-only, spreadsheets only. No `drive.*` scopes.
- Secrets `fetcher/credentials.json` and `fetcher/token.json` are gitignored and never committed (already in `.gitignore`).
- The fetcher MUST NOT overwrite an existing valid `trades.json` on any failure (network, auth, parse, or zero rows parsed). A stale-but-valid file beats a broken one.
- `trades.json` is written atomically (temp file + `os.replace`).
- Trade-object field names must match exactly what the component reads: `acquired, expires, status, ticker, contracts, type, premium, strike, price, buffer, riskLevel, riskCategory, duration, estYield, closedOn, gainLoss, capital, realYield`.
- `riskCategory` values must be emoji-free and one of: `Very Safe, Safe, Alert, Danger, ITM, Deep ITM`.
- The sample fixture is the real export at `/Users/eduardooliveira/Downloads/Short Puts and Covered Calls - Master (66).csv` — 148 data rows.
- The Python fetcher's environment is managed exclusively with `uv` (`pyproject.toml` + `uv.lock`, both committed). Never use `pip`, `requirements.txt`, or a hand-managed `venv`. Run Python via `uv run …`, which auto-syncs from the lockfile before executing.

---

### Task 1: Fetcher row normalizer (pure, TDD)

Builds the fetcher package and the pure row→trade-object normalizer, tested against the real sample CSV. No Google I/O yet.

**Files:**
- Create: `fetcher/normalize.py`
- Create: `fetcher/pyproject.toml` + `fetcher/uv.lock` (via `uv init`/`uv add`)
- Create: `fetcher/tests/__init__.py` (empty)
- Create: `fetcher/tests/fixtures/sample_master.csv` (copy of the real export)
- Test: `fetcher/tests/test_normalize.py`

**Interfaces:**
- Produces:
  - `normalize_rows(rows: list[list[str]]) -> list[dict]` — `rows` includes the header at index 0; returns one dict per real trade row (summary rows skipped).
  - `normalize_csv_text(text: str) -> list[dict]` — convenience wrapper that CSV-parses then calls `normalize_rows`.
  - Each dict has exactly the 18 fields listed in Global Constraints.

- [ ] **Step 1: Create the package skeleton and copy the fixture**

```bash
mkdir -p fetcher/tests/fixtures
touch fetcher/tests/__init__.py
cp "/Users/eduardooliveira/Downloads/Short Puts and Covered Calls - Master (66).csv" fetcher/tests/fixtures/sample_master.csv
```

Initialize the uv project and add dependencies (creates `pyproject.toml` + `uv.lock`):

```bash
cd fetcher
uv init --bare --name options-fetcher
uv add google-api-python-client google-auth-oauthlib google-auth
uv add --dev pytest
```

`uv init --bare` creates a `pyproject.toml` with no sample module. `uv add` resolves and pins into `uv.lock`. Confirm the resulting `pyproject.toml` lists the three Google libraries under `[project.dependencies]` and `pytest` under the dev group.

- [ ] **Step 2: Write the failing test**

Create `fetcher/tests/test_normalize.py`:

```python
import os
from normalize import normalize_csv_text

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sample_master.csv")


def load():
    with open(FIXTURE, encoding="utf-8") as f:
        return normalize_csv_text(f.read())


def by(trades, ticker, strike, typ):
    return next(t for t in trades if t["ticker"] == ticker and t["strike"] == strike and t["type"] == typ)


def test_row_count_is_148_and_no_summary_rows():
    trades = load()
    assert len(trades) == 148
    assert all(t["ticker"] for t in trades)          # no blank-ticker summary rows
    assert all(t["acquired"] for t in trades)


def test_closed_short_put_fields():
    t = by(load(), "JPM", 280.0, "Short Put")
    assert t["status"] == "CLOSED"
    assert t["contracts"] == 2
    assert t["acquired"] == "Dec 16, 25"
    assert t["closedOn"] == "Jan 13, 26"
    assert t["gainLoss"] == 266.62
    assert t["capital"] == 56000.0
    assert t["realYield"] == 6.21
    assert t["premium"] is None
    assert t["price"] is None
    assert t["riskCategory"] is None


def test_in_play_covered_call_fields():
    t = by(load(), "AMZN", 280.0, "Covered Call")
    assert t["status"] == "IN PLAY"
    assert t["premium"] == 224.33
    assert t["price"] == 233.74
    assert t["buffer"] == 19.79
    assert t["riskCategory"] == "Safe"       # emoji stripped
    assert t["duration"] == 50
    assert t["estYield"] is None             # blank for covered calls
    assert t["riskLevel"] is None


def test_in_play_put_itm_and_negative_buffer():
    t = by(load(), "GOOGL", 320.0, "Short Put")
    assert t["status"] == "IN PLAY"
    assert t["buffer"] == -0.45
    assert t["riskCategory"] == "ITM"
    assert t["riskLevel"] == 64000.0
    assert t["estYield"] == 5.93


def test_deep_itm_category():
    t = by(load(), "SNPS", 400.0, "Short Put")
    assert t["riskCategory"] == "Deep ITM"
    assert t["buffer"] == -7.36


def test_negative_gainloss_parses():
    t = by(load(), "MSFT", 435.0, "Short Put")
    assert t["status"] == "ASSIGNED"
    assert t["gainLoss"] == -3201.67
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd fetcher && uv run pytest tests/test_normalize.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'normalize'`.

- [ ] **Step 4: Write the implementation**

Create `fetcher/normalize.py`:

```python
"""Pure transforms: Master-sheet rows -> trade objects the dashboard consumes."""
import csv
import re

# 0-based column indices in the "Master" sheet.
COL = {
    "acquired": 0, "expires": 1, "days": 2, "position": 3, "contracts": 4,
    "ticker": 5, "type": 6, "premium": 7, "strike": 8, "price": 9,
    "buffer": 10, "risk_level": 11, "risk": 12, "duration": 13,
    "est_yield": 14, "closed_on": 15, "gain_loss": 16, "capital": 17,
    "real_yield": 18,
}


def _cell(row, i):
    return row[i].strip() if i < len(row) and row[i] is not None else ""


def _money(s):
    s = s.strip()
    if not s:
        return None
    return float(s.replace("$", "").replace(",", ""))


def _pct(s):
    s = s.strip()
    if not s:
        return None
    return float(s.replace("%", "").replace(",", ""))


def _intval(s):
    s = s.strip().replace(",", "")
    if not s:
        return None
    return int(float(s))


def _risk_category(s):
    s = s.strip()
    if not s:
        return None
    # Drop any leading non-letter characters (emoji + spaces): "🟢 Safe" -> "Safe".
    return re.sub(r"^[^A-Za-z]+", "", s).strip() or None


def _status(days_cell):
    s = days_cell.strip().replace(",", "")
    if not s:
        return None
    try:
        float(s)          # a number of days remaining -> position is open
        return "IN PLAY"
    except ValueError:
        return s           # CLOSED / ASSIGNED / EXPIRED


def normalize_row(row):
    return {
        "acquired": _cell(row, COL["acquired"]) or None,
        "expires": _cell(row, COL["expires"]) or None,
        "status": _status(_cell(row, COL["days"])),
        "ticker": _cell(row, COL["ticker"]) or None,
        "contracts": _intval(_cell(row, COL["contracts"])),
        "type": _cell(row, COL["type"]) or None,
        "premium": _money(_cell(row, COL["premium"])),
        "strike": _money(_cell(row, COL["strike"])),
        "price": _money(_cell(row, COL["price"])),
        "buffer": _pct(_cell(row, COL["buffer"])),
        "riskLevel": _money(_cell(row, COL["risk_level"])),
        "riskCategory": _risk_category(_cell(row, COL["risk"])),
        "duration": _intval(_cell(row, COL["duration"])),
        "estYield": _pct(_cell(row, COL["est_yield"])),
        "closedOn": _cell(row, COL["closed_on"]) or None,
        "gainLoss": _money(_cell(row, COL["gain_loss"])),
        "capital": _money(_cell(row, COL["capital"])),
        "realYield": _pct(_cell(row, COL["real_yield"])),
    }


def _is_data_row(row):
    # Real trades always have both an Acquired date and a ticker; summary rows don't.
    return bool(_cell(row, COL["acquired"])) and bool(_cell(row, COL["ticker"]))


def normalize_rows(rows):
    if not rows:
        return []
    return [normalize_row(r) for r in rows[1:] if _is_data_row(r)]


def normalize_csv_text(text):
    return normalize_rows(list(csv.reader(text.splitlines())))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd fetcher && uv run pytest tests/test_normalize.py -q`
Expected: PASS — 6 passed.

- [ ] **Step 6: Commit**

```bash
git add fetcher/normalize.py fetcher/pyproject.toml fetcher/uv.lock fetcher/tests/
git commit -m "feat(fetcher): sheet row normalizer with tests against sample export"
```

---

### Task 2: Fetcher OAuth, Sheets read, atomic write, entrypoint

Adds the Google I/O and the CLI entrypoint. The pure, testable pieces (atomic write, empty-guard) are TDD'd; the network/OAuth path gets a documented manual verification.

**Files:**
- Create: `fetcher/fetch_trades.py`
- Test: `fetcher/tests/test_write.py`

**Interfaces:**
- Consumes: `normalize_rows` from Task 1.
- Produces:
  - `write_json_atomic(path: str, data) -> None`
  - `write_trades(path: str, trades: list) -> None` — raises `ValueError` if `trades` is empty (guard), else atomic-writes.
  - `get_creds(cred_path, token_path) -> Credentials`
  - `fetch_rows(creds, spreadsheet_id, sheet_range) -> list[list[str]]`
  - `main() -> int` — orchestrates; returns process exit code.

- [ ] **Step 1: Write the failing test**

Create `fetcher/tests/test_write.py`:

```python
import json
import pytest
from fetch_trades import write_json_atomic, write_trades


def test_atomic_write_roundtrips(tmp_path):
    p = tmp_path / "trades.json"
    write_json_atomic(str(p), [{"ticker": "JPM"}])
    assert json.loads(p.read_text()) == [{"ticker": "JPM"}]
    assert not (tmp_path / "trades.json.tmp").exists()   # temp cleaned up


def test_write_trades_refuses_empty_and_keeps_existing(tmp_path):
    p = tmp_path / "trades.json"
    write_trades(str(p), [{"ticker": "OLD"}])
    with pytest.raises(ValueError):
        write_trades(str(p), [])                          # empty -> refuse
    assert json.loads(p.read_text()) == [{"ticker": "OLD"}]  # untouched
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd fetcher && uv run pytest tests/test_write.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'fetch_trades'`.

- [ ] **Step 3: Write the implementation**

Create `fetcher/fetch_trades.py`:

```python
"""Fetch the one Master sheet via OAuth and write trades.json atomically.

Config via environment variables (with defaults):
  SPREADSHEET_ID   the Sheet's ID (from its URL) -- REQUIRED
  SHEET_RANGE      tab/range to read (default "Master")
  OUTPUT_PATH      where to write trades.json (default "trades.json")
  CREDENTIALS_PATH OAuth client secret (default "credentials.json")
  TOKEN_PATH       stored refresh token (default "token.json")
"""
import json
import os
import sys

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from normalize import normalize_rows

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def write_json_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)   # atomic on POSIX


def write_trades(path, trades):
    if not trades:
        raise ValueError("normalizer produced 0 trades; refusing to overwrite")
    write_json_atomic(path, trades)


def get_creds(cred_path, token_path):
    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(cred_path, SCOPES)
            creds = flow.run_local_server(port=0)   # opens browser once
        with open(token_path, "w", encoding="utf-8") as f:
            f.write(creds.to_json())
    return creds


def fetch_rows(creds, spreadsheet_id, sheet_range):
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=spreadsheet_id,
            range=sheet_range,
            valueRenderOption="FORMATTED_VALUE",
        )
        .execute()
    )
    return resp.get("values", [])


def main():
    spreadsheet_id = os.environ.get("SPREADSHEET_ID", "")
    sheet_range = os.environ.get("SHEET_RANGE", "Master")
    output_path = os.environ.get("OUTPUT_PATH", "trades.json")
    cred_path = os.environ.get("CREDENTIALS_PATH", "credentials.json")
    token_path = os.environ.get("TOKEN_PATH", "token.json")

    if not spreadsheet_id:
        print("ERROR: SPREADSHEET_ID is not set", file=sys.stderr)
        return 2
    try:
        creds = get_creds(cred_path, token_path)
        rows = fetch_rows(creds, spreadsheet_id, sheet_range)
        trades = normalize_rows(rows)
        write_trades(output_path, trades)   # guards empty, writes atomically
        print(f"OK: wrote {len(trades)} trades to {output_path}")
        return 0
    except Exception as exc:  # noqa: BLE001 - log and leave existing file intact
        print(f"ERROR: fetch failed, leaving {output_path} untouched: {exc}",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd fetcher && uv run pytest tests/test_write.py -q`
Expected: PASS — 2 passed.

Note: `test_write.py` imports `fetch_trades`, which imports Google libraries. `uv run` auto-syncs the environment from `uv.lock` before running, so no separate install step is needed.

- [ ] **Step 5: Manual OAuth verification (one time)**

This proves the live path end-to-end. Requires `fetcher/credentials.json` (an OAuth **Desktop app** client from Google Cloud Console → APIs & Services → Credentials, with the Google Sheets API enabled) and the Sheet's ID.

```bash
cd fetcher
SPREADSHEET_ID="<paste-sheet-id>" OUTPUT_PATH="trades.json" uv run python fetch_trades.py
```

(`uv run` syncs the environment from `uv.lock` on first invocation, so no separate install/activate step is needed.)

Expected: a browser opens for consent the first time; then `OK: wrote 148 trades to trades.json`, `token.json` is created, and `trades.json` contains the array. Re-running does NOT reopen the browser.

- [ ] **Step 6: Commit**

```bash
git add fetcher/fetch_trades.py fetcher/tests/test_write.py
git commit -m "feat(fetcher): OAuth Sheets read + atomic, fail-safe trades.json write"
```

---

### Task 3: Vite + Tailwind app scaffold and tested data module

Scaffolds the web app and the small, testable data-loading helper. The dashboard component is ported in Task 4.

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.js`
- Create: `web/index.html`
- Create: `web/src/index.css`
- Create: `web/src/main.jsx`
- Create: `web/src/data.js`
- Test: `web/src/data.test.js`

**Interfaces:**
- Produces:
  - `signature(text: string) -> string` — stable hash used as a React `key` so the dashboard remounts only when data content changes.
  - `loadTrades(url?: string) -> Promise<{ trades: Array, sig: string }>` — fetches, parses, and signs `trades.json`.

- [ ] **Step 1: Scaffold config files**

Create `web/package.json`:

```json
{
  "name": "options-dashboard-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "lucide-react": "^0.400.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.12.7"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^4.3.1",
    "tailwindcss": "^4.0.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

Create `web/vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
});
```

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Options Dashboard</title>
  </head>
  <body style="margin:0;background:#09090b">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Create `web/src/index.css`:

```css
@import "tailwindcss";
```

Create `web/src/main.jsx`:

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
```

Note: `App.jsx` is created in Task 4; the app will not build until then. That is expected.

- [ ] **Step 2: Write the failing test**

Create `web/src/data.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { signature, loadTrades } from './data.js';

afterEach(() => vi.restoreAllMocks());

describe('signature', () => {
  it('is stable for identical input', () => {
    expect(signature('abc')).toBe(signature('abc'));
  });
  it('differs for different input', () => {
    expect(signature('abc')).not.toBe(signature('abd'));
  });
  it('handles empty string', () => {
    expect(typeof signature('')).toBe('string');
  });
});

describe('loadTrades', () => {
  it('parses and signs fetched json', async () => {
    const body = JSON.stringify([{ ticker: 'JPM' }]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(body) });
    const { trades, sig } = await loadTrades('/trades.json');
    expect(trades).toEqual([{ ticker: 'JPM' }]);
    expect(sig).toBe(signature(body));
  });
  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(loadTrades('/trades.json')).rejects.toThrow('404');
  });
});
```

- [ ] **Step 3: Install deps and run the test to verify it fails**

Run:
```bash
cd web && npm install && npm test
```
Expected: FAIL — cannot resolve `./data.js`.

- [ ] **Step 4: Write the implementation**

Create `web/src/data.js`:

```js
// Stable djb2 hash -> string. Used as a React key so the dashboard remounts
// only when trades.json content actually changes (preserves filters otherwise).
export function signature(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

export async function loadTrades(url = '/trades.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`trades.json fetch failed: ${res.status}`);
  const text = await res.text();
  return { trades: JSON.parse(text), sig: signature(text) };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npm test`
Expected: PASS — 5 passed.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/vite.config.js web/index.html web/src/index.css web/src/main.jsx web/src/data.js web/src/data.test.js web/package-lock.json
git commit -m "feat(web): vite+tailwind scaffold and tested trades data loader"
```

---

### Task 4: Port the dashboard component and wire live data

Brings in the existing component with one surgical change (data from a prop, not a hardcoded array) and adds the `App` wrapper that loads/refreshes data.

**Files:**
- Create: `web/src/TradingDashboard.jsx` (ported from `/Users/eduardooliveira/Downloads/portfolio_dashboard.jsx`)
- Create: `web/src/App.jsx`

**Interfaces:**
- Consumes: `loadTrades` from Task 3.
- Produces: `TradingDashboard` default export taking a single prop `tradesData: Array`.

- [ ] **Step 1: Copy the component in**

```bash
cp "/Users/eduardooliveira/Downloads/portfolio_dashboard.jsx" web/src/TradingDashboard.jsx
```

- [ ] **Step 2: Remove the hardcoded data array**

In `web/src/TradingDashboard.jsx`, delete the entire literal `const TRADES = [ ... ];` block (starts at `const TRADES = [` near the top, ends at the line `];` immediately before the `// Helper functions` comment). Leave the helper functions and everything else intact.

- [ ] **Step 3: Feed data in via a prop (minimal, safe swap)**

Change the component signature and add one line as its first statement. Find:

```jsx
export default function TradingDashboard() {
```

Replace with:

```jsx
export default function TradingDashboard({ tradesData }) {
  const TRADES = tradesData;
```

Rationale: every internal reference to `TRADES` keeps working unchanged. The lowercase `trades` used elsewhere is a prop of the child `TradeLedger`/`CallsLedger` components (separate scope) and is unaffected. The `App` wrapper remounts this component (via `key`) whenever data changes, so the `useMemo(..., [])` blocks recompute correctly with fresh data.

- [ ] **Step 4: Create the App wrapper**

Create `web/src/App.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import TradingDashboard from './TradingDashboard.jsx';
import { loadTrades } from './data.js';

const REFRESH_MS = 10 * 60 * 1000;

export default function App() {
  const [state, setState] = useState({ trades: null, sig: null });
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { trades, sig } = await loadTrades();
        if (active) { setState({ trades, sig }); setError(null); }
      } catch (e) {
        // Keep showing the last good data; only surface if we never loaded.
        if (active) setError(e);
        console.error('trades load failed', e);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (!state.trades) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center',
                    background: '#09090b', color: '#a1a1aa', fontFamily: 'system-ui' }}>
        {error ? 'Could not load trades.json — is the fetcher running?' : 'Loading trades…'}
      </div>
    );
  }
  return <TradingDashboard tradesData={state.trades} key={state.sig} />;
}
```

- [ ] **Step 5: Verify the build succeeds**

Run: `cd web && npm run build`
Expected: `vite build` completes and writes `web/dist/` with `index.html` and `assets/`. No unresolved-import or JSX errors.

- [ ] **Step 6: Verify it renders with a fixture (manual e2e)**

```bash
cd web
cp ../fetcher/trades.json dist/trades.json   # from Task 2 Step 5; or hand-make a small array
npx vite preview --port 4173
```
Open http://localhost:4173 — confirm the dashboard renders with real numbers (not the loading screen), charts draw, and the ledger tables populate.

- [ ] **Step 7: Commit**

```bash
git add web/src/TradingDashboard.jsx web/src/App.jsx
git commit -m "feat(web): load dashboard data from trades.json with 10-min refresh"
```

---

### Task 5: Scheduling, hosting, and operator docs

Adds the two launchd jobs (static server + periodic fetcher) and a README so the whole thing is reproducible.

**Files:**
- Create: `scripts/net.eduardooliveira.options-fetch.plist`
- Create: `scripts/net.eduardooliveira.options-serve.plist`
- Create: `scripts/run_fetch.sh`
- Create: `README.md`

**Interfaces:** none (operational).

- [ ] **Step 1: Fetcher wrapper script**

Create `scripts/run_fetch.sh` (writes `trades.json` into the served `dist/`):

```bash
#!/bin/bash
set -euo pipefail
ROOT="/Users/eduardooliveira/projects/options-dashboard"
# launchd runs with a minimal PATH; use uv's absolute path.
# Find yours with `command -v uv` (e.g. /opt/homebrew/bin/uv or ~/.local/bin/uv).
UV="/opt/homebrew/bin/uv"
cd "$ROOT/fetcher"
export SPREADSHEET_ID="<paste-sheet-id>"
export SHEET_RANGE="Master"
export OUTPUT_PATH="$ROOT/web/dist/trades.json"
export CREDENTIALS_PATH="$ROOT/fetcher/credentials.json"
export TOKEN_PATH="$ROOT/fetcher/token.json"
# `uv run` auto-syncs from uv.lock before executing, so the job self-heals if the env drifts.
exec "$UV" run --project "$ROOT/fetcher" python fetch_trades.py
```

```bash
chmod +x scripts/run_fetch.sh
```

- [ ] **Step 2: Fetcher launchd job (every 10 min)**

Create `scripts/net.eduardooliveira.options-fetch.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>net.eduardooliveira.options-fetch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/eduardooliveira/projects/options-dashboard/scripts/run_fetch.sh</string>
  </array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/eduardooliveira/projects/options-dashboard/fetch.log</string>
  <key>StandardErrorPath</key><string>/Users/eduardooliveira/projects/options-dashboard/fetch.err.log</string>
</dict>
</plist>
```

- [ ] **Step 3: Static server launchd job (kept alive)**

Create `scripts/net.eduardooliveira.options-serve.plist` (serves `web/dist/` on port 4173):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>net.eduardooliveira.options-serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>-m</string>
    <string>http.server</string>
    <string>4173</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/eduardooliveira/projects/options-dashboard/web/dist</string>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>/Users/eduardooliveira/projects/options-dashboard/serve.err.log</string>
</dict>
</plist>
```

- [ ] **Step 4: Write the README**

Create `README.md` documenting one-time setup and load/unload. Content:

```markdown
# Options Dashboard

Auto-refreshing options-trading dashboard fed from one Google Sheet.

## One-time setup
1. Google Cloud Console: enable the **Google Sheets API**, create an OAuth
   **Desktop app** client, download it to `fetcher/credentials.json`.
2. `cd fetcher && uv sync` (creates the environment from `uv.lock`; optional —
   `uv run` also syncs on demand).
3. First consent (opens a browser once):
   `SPREADSHEET_ID="<id>" OUTPUT_PATH="../web/dist/trades.json" uv run python fetch_trades.py`
   (Build the web app first so `web/dist/` exists — see below.)
4. `cd web && npm install && npm run build`
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
```

- [ ] **Step 5: Load and verify end-to-end (manual)**

```bash
cp scripts/net.eduardooliveira.options-*.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/net.eduardooliveira.options-serve.plist
launchctl load ~/Library/LaunchAgents/net.eduardooliveira.options-fetch.plist
sleep 5 && tail fetch.log
open http://localhost:4173
```
Expected: `fetch.log` shows `OK: wrote 148 trades…`; the dashboard loads at localhost:4173; `dist/trades.json` updates on each 10-min tick.

- [ ] **Step 6: Commit**

```bash
git add scripts/ README.md
git commit -m "feat(ops): launchd fetch+serve jobs and setup README"
```

---

## Self-Review Notes

- **Spec coverage:** Fetcher/auth/normalize/atomic-write/fail-safe → Tasks 1–2. Dashboard fetch + 10-min refresh + preserve-last-good → Task 4 (+ data module Task 3). launchd fetch + static serve, launchd-not-crontab, build-once → Task 5. Data-mapping table → Task 1 tests assert each transform (status rule, `$`/`%`/`,` parsing, emoji strip, summary-row skip). Open items (Sheet ID, port 4173, plist label `net.eduardooliveira.*`) are resolved here.
- **Type consistency:** `signature`/`loadTrades` defined in Task 3 and consumed in Task 4; `tradesData` prop defined and consumed in Task 4; `normalize_rows`/`write_trades`/`write_json_atomic` names consistent across Tasks 1–2.
- **Placeholder scan:** the only literal placeholder is `<paste-sheet-id>` — an intentional user secret, called out in Task 2 Step 5, Task 5 Step 1, and the README.
```
