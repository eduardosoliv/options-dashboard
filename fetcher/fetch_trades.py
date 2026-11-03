"""Fetch the one Master sheet via OAuth and write trades.json atomically.

Config lives in `config.toml` at the project root (git-ignored). Copy
`config-example.toml` to `config.toml` and fill it in, then just run:

  uv run python fetch_trades.py

config.toml keys:
  spreadsheet_id   the Sheet's ID (from its URL) -- REQUIRED
  sheet_range      tab/range to read (default "Master")
  output_path      where to write trades.json, relative to the project root
                   (default "web/dist/trades.json")
  [benchmarks]     optional annualized %, written to benchmarks.json next to
                   trades.json: put_return (Cboe PutWrite Index, PUT),
                   tbill_return (T-bill rate assumed on put collateral),
                   period (label for the window they cover)
  assignments_range  optional tab with broker lots + price history for the
                   Assigned & Called section (default "AssignedCalled"),
                   written to assignments.json next to trades.json; a missing
                   or malformed tab only warns

OAuth file locations can still be overridden via the environment:
  CREDENTIALS_PATH OAuth client secret (default fetcher/credentials.json)
  TOKEN_PATH       stored refresh token (default fetcher/token.json)
"""

import json
import os
import sys
import tomllib
from pathlib import Path
from typing import Any, TypedDict

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from assignments import parse_assigned_called
from diff import diff_trades, format_summary
from normalize import Trade, normalize_rows

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# This script lives in fetcher/; the project root is its parent.
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
CONFIG_PATH = PROJECT_ROOT / "config.toml"
EXAMPLE_CONFIG_PATH = PROJECT_ROOT / "config-example.toml"


class Benchmarks(TypedDict):
    """Strategy-index returns from config.toml, as written to benchmarks.json."""

    putReturn: float | None  # camelCase: matches the dashboard's JSON keys
    tbillReturn: float | None
    period: str | None


def write_json_atomic(path: str, data: object) -> None:
    tmp = Path(f"{path}.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(path)  # atomic on POSIX


def read_existing_trades(path: str) -> list[Trade]:
    """Return the trades currently in `path`, or [] if missing/unreadable.

    Used only to summarize changes; never raises, so a corrupt or absent file
    can't block a fetch.
    """
    try:
        with Path(path).open(encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def write_trades(path: str, trades: list[Trade]) -> None:
    if not trades:
        raise ValueError("normalizer produced 0 trades; refusing to overwrite")
    write_json_atomic(path, trades)


def get_creds(cred_path: str, token_path: str) -> Credentials:
    creds: Credentials | None = None
    if Path(token_path).exists():
        # google-auth ships types but leaves these classmethods unannotated.
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)  # type: ignore[no-untyped-call]
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())  # type: ignore[no-untyped-call]
        else:
            flow = InstalledAppFlow.from_client_secrets_file(cred_path, SCOPES)
            creds = flow.run_local_server(port=0)  # opens browser once
        with Path(token_path).open("w", encoding="utf-8") as f:
            f.write(creds.to_json())
    return creds


def fetch_rows(
    creds: Credentials,
    spreadsheet_id: str,
    sheet_range: str,
    render: str = "FORMATTED_VALUE",
    date_render: str = "FORMATTED_STRING",
) -> list[list[Any]]:
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    resp = (
        service.spreadsheets()
        .values()
        .get(
            spreadsheetId=spreadsheet_id,
            range=sheet_range,
            valueRenderOption=render,
            dateTimeRenderOption=date_render,
        )
        .execute()
    )
    values: list[list[Any]] = resp.get("values", [])
    return values


class ConfigError(Exception):
    """Raised when config.toml is missing or incomplete."""


def _read_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        msg = (
            f"no config file at {CONFIG_PATH}\n"
            f"  Copy {EXAMPLE_CONFIG_PATH.name} to config.toml and fill in your Sheet ID."
        )
        raise ConfigError(msg)
    with CONFIG_PATH.open("rb") as f:
        return tomllib.load(f)


def parse_benchmarks(cfg: dict[str, Any]) -> Benchmarks | None:
    """Return the `[benchmarks]` table as Benchmarks, or None if it's absent."""
    table = cfg.get("benchmarks")
    if table is None:
        return None
    if not isinstance(table, dict):
        msg = "'benchmarks' must be a table: [benchmarks]"
        raise ConfigError(msg)

    def pct(key: str) -> float | None:
        value = table.get(key)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int | float):
            msg = f"benchmarks.{key} must be a number (annualized %), got {value!r}"
            raise ConfigError(msg)
        return float(value)

    period = str(table.get("period", "")).strip() or None
    return {"putReturn": pct("put_return"), "tbillReturn": pct("tbill_return"), "period": period}


def load_benchmarks() -> Benchmarks | None:
    """Return the optional `[benchmarks]` table from config.toml."""
    return parse_benchmarks(_read_config())


def load_config() -> tuple[str, str, str]:
    """Return (spreadsheet_id, sheet_range, output_path) from config.toml.

    output_path is resolved to an absolute path relative to the project root.
    """
    cfg = _read_config()

    spreadsheet_id = str(cfg.get("spreadsheet_id", "")).strip()
    if not spreadsheet_id or spreadsheet_id == "paste-your-sheet-id-here":
        msg = f"set 'spreadsheet_id' in {CONFIG_PATH}"
        raise ConfigError(msg)

    sheet_range = str(cfg.get("sheet_range", "Master")).strip() or "Master"

    raw_output = str(cfg.get("output_path", "web/dist/trades.json")).strip()
    output = Path(raw_output)
    if not output.is_absolute():
        output = PROJECT_ROOT / output
    return spreadsheet_id, sheet_range, str(output)


def load_assignments_range() -> str:
    """Tab holding broker lots + price history (optional; default AssignedCalled)."""
    return (
        str(_read_config().get("assignments_range", "AssignedCalled")).strip() or "AssignedCalled"
    )


def fetch_assignment_rows(
    creds: Credentials, spreadsheet_id: str, tab: str
) -> list[list[Any]] | None:
    """The tab's raw values (dates as serial numbers), or None if it doesn't exist."""
    try:
        return fetch_rows(creds, spreadsheet_id, tab, "UNFORMATTED_VALUE", "SERIAL_NUMBER")
    except HttpError as exc:
        if exc.resp.status == 400:  # noqa: PLR2004 - Sheets answers 400 "Unable to parse range"
            return None
        raise


def update_assignments(creds: Credentials, spreadsheet_id: str, output_path: str) -> None:
    """Write assignments.json next to trades.json. Optional: never raises; a
    missing or malformed tab warns and leaves any existing file untouched."""
    path = Path(output_path).with_name("assignments.json")
    try:
        tab = load_assignments_range()
        rows = fetch_assignment_rows(creds, spreadsheet_id, tab)
        if rows is None:
            print(f"WARNING: no '{tab}' tab; skipping assignments.json", file=sys.stderr)
            return
        data = parse_assigned_called(rows)
        write_json_atomic(str(path), data)
    except Exception as exc:  # noqa: BLE001 - optional extra: warn, never block the fetch
        print(f"WARNING: skipping assignments.json, leaving it untouched: {exc}", file=sys.stderr)
    else:
        lots = len(data["held"]) + len(data["sold"])
        print(f"OK: wrote {lots} lots and {len(data['series'])} price series to {path}")


def main() -> int:
    try:
        spreadsheet_id, sheet_range, output_path = load_config()
    except ConfigError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    cred_path = os.environ.get("CREDENTIALS_PATH", str(SCRIPT_DIR / "credentials.json"))
    token_path = os.environ.get("TOKEN_PATH", str(SCRIPT_DIR / "token.json"))

    # Benchmarks are optional extras: a bad table warns but never blocks the trades fetch.
    try:
        benchmarks = load_benchmarks()
        if benchmarks is not None:
            write_json_atomic(str(Path(output_path).with_name("benchmarks.json")), benchmarks)
    except (ConfigError, OSError) as exc:
        print(f"WARNING: skipping benchmarks.json: {exc}", file=sys.stderr)

    try:
        previous = read_existing_trades(output_path)
        creds = get_creds(cred_path, token_path)
        rows = fetch_rows(creds, spreadsheet_id, sheet_range)
        # Same range again as formulas: ASSIGNED/CALLED Gain/Loss formulas carry
        # the exit price and premium, which the rendered values don't expose.
        formula_rows = fetch_rows(creds, spreadsheet_id, sheet_range, render="FORMULA")
        trades = normalize_rows(rows, formula_rows)
        write_trades(output_path, trades)  # guards empty, writes atomically
    except Exception as exc:  # noqa: BLE001 - log and leave existing file intact
        print(f"ERROR: fetch failed, leaving {output_path} untouched: {exc}", file=sys.stderr)
        return 1
    else:
        print(f"OK: wrote {len(trades)} trades to {output_path}")
        if previous:
            print(format_summary(diff_trades(previous, trades)))
        else:
            print("  (baseline: no previous trades.json)")
        update_assignments(creds, spreadsheet_id, output_path)
        return 0


if __name__ == "__main__":
    sys.exit(main())
