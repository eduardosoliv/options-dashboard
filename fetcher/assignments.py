"""Parse the optional AssignedCalled tab into the dashboard's assignments.json.

The tab has two side-by-side areas (read with UNFORMATTED_VALUE + SERIAL_NUMBER
dates, so dates arrive as spreadsheet serial numbers):

  A-F  broker lots, one per row under a header row:
       Ticker | Acquired | Quantity | Cost basis | Sold on | Proceeds
       (totals, not per share; Sold on / Proceeds blank while held)
  H+   price history: column H labels the rows "Key" (dashboard ticker, e.g.
       SPX), "Google symbol", then "Prices" (the GOOGLEFINANCE header row,
       Date | Close); each ticker owns a Date/Close column pair, with daily
       closes below the "Prices" row.

Output (camelCase, read by web/src/assignments.js):
  { asOf, held: [{ticker, acquired, quantity, costBasis}],
    sold: [{..., sold, proceeds}], series: {KEY: [[iso date, close], ...]} }
"""

from datetime import date, timedelta
from typing import Any, NotRequired, TypedDict

# Google Sheets' serial-date epoch (day 0).
SHEETS_EPOCH = date(1899, 12, 30)
LABEL_COL = 7  # column H
LOT_COLS = 6  # A-F


class Lot(TypedDict):
    ticker: str
    acquired: str
    quantity: float
    costBasis: float  # camelCase: matches the dashboard's JSON keys
    sold: NotRequired[str]
    proceeds: NotRequired[float]


class Assignments(TypedDict):
    asOf: str
    held: list[Lot]
    sold: list[Lot]
    series: dict[str, list[tuple[str, float]]]


def _cell(row: list[Any], i: int) -> Any:
    return row[i] if i < len(row) else ""


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def to_iso(value: Any) -> str:
    """Serial number (time of day dropped) or 'YYYY-MM-DD' text → ISO date."""
    if isinstance(value, bool):
        msg = f"not a date: {value!r}"
        raise TypeError(msg)
    if isinstance(value, int | float):
        return (SHEETS_EPOCH + timedelta(days=int(value))).isoformat()
    if isinstance(value, str):
        return date.fromisoformat(value.strip()).isoformat()
    msg = f"not a date: {value!r}"
    raise TypeError(msg)


def _number(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        msg = f"{what} must be a number, got {value!r}"
        raise TypeError(msg)
    return float(value)


def parse_lots(rows: list[list[Any]]) -> tuple[list[Lot], list[Lot]]:
    """(held, sold) lots from columns A-F; stops at the first blank ticker."""
    held: list[Lot] = []
    sold: list[Lot] = []
    for n, row in enumerate(rows[1:], start=2):
        ticker = _cell(row, 0)
        if _is_blank(ticker):
            break
        where = f"lot row {n}"
        lot: Lot = {
            "ticker": str(ticker).strip(),
            "acquired": to_iso(_cell(row, 1)),
            "quantity": _number(_cell(row, 2), f"{where} quantity"),
            "costBasis": _number(_cell(row, 3), f"{where} cost basis"),
        }
        if _is_blank(_cell(row, 4)):
            held.append(lot)
        else:
            lot["sold"] = to_iso(_cell(row, 4))
            lot["proceeds"] = _number(_cell(row, 5), f"{where} proceeds")
            sold.append(lot)
    return held, sold


def _label_row(rows: list[list[Any]], label: str) -> int:
    for i, row in enumerate(rows):
        if str(_cell(row, LABEL_COL)).strip() == label:
            return i
    msg = f"no '{label}' label in column H"
    raise ValueError(msg)


def parse_prices(rows: list[list[Any]]) -> dict[str, list[tuple[str, float]]]:
    """Daily closes per dashboard key from the Date/Close column pairs."""
    keys = rows[_label_row(rows, "Key")]
    data = rows[_label_row(rows, "Prices") + 1 :]
    series: dict[str, list[tuple[str, float]]] = {}
    for col in range(LABEL_COL + 1, len(keys), 2):
        key = _cell(keys, col)
        if _is_blank(key):
            continue
        points = [
            (to_iso(_cell(row, col)), float(_cell(row, col + 1)))
            for row in data
            if isinstance(_cell(row, col), int | float)
            and isinstance(_cell(row, col + 1), int | float)
        ]
        if points:
            series[str(key).strip()] = sorted(points)
    return series


def parse_assigned_called(rows: list[list[Any]]) -> Assignments:
    """Whole tab → Assignments; raises ValueError/TypeError on a malformed tab."""
    if not rows:
        msg = "the tab is empty"
        raise ValueError(msg)
    held, sold = parse_lots(rows)
    series = parse_prices(rows)
    if not series:
        msg = "no price history (are the GOOGLEFINANCE formulas loaded?)"
        raise ValueError(msg)
    as_of = max(points[-1][0] for points in series.values())
    return {"asOf": as_of, "held": held, "sold": sold, "series": series}
