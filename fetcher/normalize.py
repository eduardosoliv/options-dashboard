"""Pure transforms: Master-sheet rows -> trade objects the dashboard consumes."""

import csv
import re

# A normalized trade: mixed scalar values, with None for blank cells.
Trade = dict[str, str | float | int | None]

# 0-based column indices in the "Master" sheet.
COL: dict[str, int] = {
    "acquired": 0,
    "expires": 1,
    "days": 2,
    "position": 3,
    "contracts": 4,
    "ticker": 5,
    "type": 6,
    "premium": 7,
    "strike": 8,
    "price": 9,
    "buffer": 10,
    "risk": 11,
    "risk_level": 12,
    "duration": 13,
    "est_yield": 14,
    "closed_on": 15,
    "gain_loss": 16,
    "capital": 17,
    "real_yield": 18,
}


def _cell(row: list[str], i: int) -> str:
    return row[i].strip() if i < len(row) and row[i] is not None else ""


def _money(s: str) -> float | None:
    s = s.strip()
    if not s:
        return None
    return float(s.replace("$", "").replace(",", ""))


def _pct(s: str) -> float | None:
    s = s.strip()
    if not s:
        return None
    return float(s.replace("%", "").replace(",", ""))


def _intval(s: str) -> int | None:
    s = s.strip().replace(",", "")
    if not s:
        return None
    return int(float(s))


def _risk_category(s: str) -> str | None:
    s = s.strip()
    if not s:
        return None
    # Drop any leading non-letter characters (emoji + spaces): "🟢 Safe" -> "Safe".
    return re.sub(r"^[^A-Za-z]+", "", s).strip() or None


def _status(days_cell: str) -> str | None:
    s = days_cell.strip().replace(",", "")
    if not s:
        return None
    try:
        float(s)  # a number of days remaining -> position is open
    except ValueError:
        return s  # CLOSED / ASSIGNED / EXPIRED / CALLED
    return "IN PLAY"


# ASSIGNED / CALLED rows compute Gain/Loss with a formula that embeds the stock
# price at assignment/call and the premium collected, e.g.
#   put:  =-(($E12*100)*($I12-397.85))+(513.33)
#   call: =-(($E128*100)*(260.21-$I128))+(317.34)
_EXIT_FORMULA = re.compile(
    r"^=\s*-\s*\(\s*\(\s*\$?E\$?\d+\s*\*\s*100\s*\)\s*\*\s*\(\s*"
    r"(?:\$?I\$?\d+\s*-\s*(?P<put>[\d.]+)|(?P<call>[\d.]+)\s*-\s*\$?I\$?\d+)"
    r"\s*\)\s*\)\s*\+\s*\(\s*(?P<premium>[\d.]+)\s*\)\s*$",
)
# CLOSED rows may write Gain/Loss as premium minus buyback cost: =(317.34)-(120)
_CLOSE_FORMULA = re.compile(
    r"^=\s*\(?\s*(?P<premium>[\d.]+)\s*\)?\s*-\s*\(?\s*(?P<cost>[\d.]+)\s*\)?\s*$",
)


def _formula_terms(formula: object) -> tuple[float | None, float | None, float | None]:
    """Return (exit price, premium collected, closing cost) from a Gain/Loss formula."""
    # The FORMULA render returns plain numbers (not strings) for non-formula cells.
    if not isinstance(formula, str):
        return None, None, None
    if m := _EXIT_FORMULA.match(formula.strip()):
        return float(m["put"] or m["call"]), float(m["premium"]), None
    if m := _CLOSE_FORMULA.match(formula.strip()):
        return None, float(m["premium"]), float(m["cost"])
    return None, None, None


def normalize_row(row: list[str], formula_row: list[object] | None = None) -> Trade:
    i = COL["gain_loss"]
    exit_price, premium_collected, close_cost = _formula_terms(
        formula_row[i] if formula_row and i < len(formula_row) else None
    )
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
        "exitPrice": exit_price,
        "premiumCollected": premium_collected,
        "closeCost": close_cost,
    }


def _is_data_row(row: list[str]) -> bool:
    # Real trades always have both an Acquired date and a ticker; summary rows don't.
    return bool(_cell(row, COL["acquired"])) and bool(_cell(row, COL["ticker"]))


def _is_call_spread(row: list[str]) -> bool:
    # Call spreads live in the sheet but are deliberately not imported.
    return "call spread" in _cell(row, COL["type"]).lower()


def normalize_rows(
    rows: list[list[str]], formula_rows: list[list[object]] | None = None
) -> list[Trade]:
    """Normalize rendered rows; `formula_rows` is the same range read with formulas, row-aligned."""
    if not rows:
        return []
    formulas = formula_rows or []
    return [
        normalize_row(r, formulas[i] if i < len(formulas) else None)
        for i, r in enumerate(rows)
        if i > 0 and _is_data_row(r) and not _is_call_spread(r)
    ]


def normalize_csv_text(text: str) -> list[Trade]:
    return normalize_rows(list(csv.reader(text.splitlines())))
