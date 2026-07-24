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
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from normalize import Trade, normalize_rows

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def write_json_atomic(path: str, data: object) -> None:
    tmp = Path(f"{path}.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(path)  # atomic on POSIX


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


def main() -> int:
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
        write_trades(output_path, trades)  # guards empty, writes atomically
    except Exception as exc:  # noqa: BLE001 - log and leave existing file intact
        print(f"ERROR: fetch failed, leaving {output_path} untouched: {exc}", file=sys.stderr)
        return 1
    else:
        print(f"OK: wrote {len(trades)} trades to {output_path}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
