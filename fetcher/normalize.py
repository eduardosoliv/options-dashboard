"""Pure transforms: Master-sheet rows -> trade objects the dashboard consumes."""
import csv
import re

# 0-based column indices in the "Master" sheet.
COL = {
    "acquired": 0, "expires": 1, "days": 2, "position": 3, "contracts": 4,
    "ticker": 5, "type": 6, "premium": 7, "strike": 8, "price": 9,
    "buffer": 10, "risk": 11, "risk_level": 12, "duration": 13,
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
    trades = [normalize_row(r) for r in rows[1:] if _is_data_row(r)]
    # IN PLAY rows first (status is None only for malformed rows; CLOSED/ASSIGNED/EXPIRED after).
    return sorted(trades, key=lambda t: 0 if t["status"] == "IN PLAY" else 1)


def normalize_csv_text(text):
    return normalize_rows(list(csv.reader(text.splitlines())))
