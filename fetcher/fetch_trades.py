"""Fetch the one Master sheet via OAuth and write trades.json atomically.

Config lives in `config.toml` at the project root (git-ignored). Copy
`config-example.toml` to `config.toml` and fill it in, then just run:

  uv run python fetch_trades.py

config.toml keys:
  spreadsheet_id   the Sheet's ID (from its URL) -- REQUIRED
  sheet_range      tab/range to read (default "Master")
  output_path      where to write trades.json, relative to the project root
                   (default "web/dist/trades.json")

OAuth file locations can still be overridden via the environment:
  CREDENTIALS_PATH OAuth client secret (default fetcher/credentials.json)
  TOKEN_PATH       stored refresh token (default fetcher/token.json)
"""

import json
import os
import sys
import tomllib
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from diff import diff_trades, format_summary
from normalize import Trade, normalize_rows

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# This script lives in fetcher/; the project root is its parent.
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
CONFIG_PATH = PROJECT_ROOT / "config.toml"
EXAMPLE_CONFIG_PATH = PROJECT_ROOT / "config-example.toml"


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


def fetch_rows(creds: Credentials, spreadsheet_id: str, sheet_range: str) -> list[list[str]]:
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
    values: list[list[str]] = resp.get("values", [])
    return values


class ConfigError(Exception):
    """Raised when config.toml is missing or incomplete."""


def load_config() -> tuple[str, str, str]:
    """Return (spreadsheet_id, sheet_range, output_path) from config.toml.

    output_path is resolved to an absolute path relative to the project root.
    """
    if not CONFIG_PATH.exists():
        msg = (
            f"no config file at {CONFIG_PATH}\n"
            f"  Copy {EXAMPLE_CONFIG_PATH.name} to config.toml and fill in your Sheet ID."
        )
        raise ConfigError(msg)
    with CONFIG_PATH.open("rb") as f:
        cfg = tomllib.load(f)

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


def main() -> int:
    try:
        spreadsheet_id, sheet_range, output_path = load_config()
    except ConfigError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    cred_path = os.environ.get("CREDENTIALS_PATH", str(SCRIPT_DIR / "credentials.json"))
    token_path = os.environ.get("TOKEN_PATH", str(SCRIPT_DIR / "token.json"))

    try:
        previous = read_existing_trades(output_path)
        creds = get_creds(cred_path, token_path)
        rows = fetch_rows(creds, spreadsheet_id, sheet_range)
        trades = normalize_rows(rows)
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
        return 0


if __name__ == "__main__":
    sys.exit(main())
