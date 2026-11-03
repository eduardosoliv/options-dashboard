from datetime import date

import pytest

from assignments import parse_assigned_called, parse_lots, parse_prices, to_iso

# Spreadsheet serial numbers for a few days (day 0 = 1899-12-30).
D1, D2, D3 = 46023, 46024, 46025  # 2026-01-01 .. 2026-01-03
CLOSE = 0.6666666666666667  # GOOGLEFINANCE stamps closes at 4pm

HEADER = [
    "Ticker",
    "Acquired",
    "Quantity",
    "Cost basis",
    "Sold on",
    "Proceeds",
    "",
    "Prices from",
    D1,
]
KEYS = ["", "", "", "", "", "", "", "Key", "SPX", "", "AAA", ""]
SYMBOLS = ["", "", "", "", "", "", "", "Google symbol", "INDEXSP:.INX", "", "NYSE:AAA", ""]
PRICES_HDR = ["", "", "", "", "", "", "", "Prices", "Date", "Close", "Date", "Close"]


def tab(lots, price_rows):
    """Build a tab: lot rows overlay the label rows in columns A-F."""
    rows = [HEADER, KEYS, SYMBOLS, PRICES_HDR, *price_rows]
    out = []
    for i, row in enumerate(rows):
        lot = lots[i - 1] if 0 < i <= len(lots) else ["", "", "", "", "", ""]
        out.append([*lot, *row[6:]] if i else row)
    out.extend([*lot, ""] for lot in lots[len(rows) - 1 :])
    return out


PRICE_ROWS = [
    ["", "", "", "", "", "", "", "", D1 + CLOSE, 1000, D1 + CLOSE, 100],
    ["", "", "", "", "", "", "", "", D2 + CLOSE, 1010, D2 + CLOSE, 104],
    ["", "", "", "", "", "", "", "", "", "", D3 + CLOSE, 108],  # index lags a day
]


def test_to_iso_reads_serials_and_iso_text():
    assert to_iso(D1) == "2026-01-01"
    assert to_iso(D2 + CLOSE) == "2026-01-02"
    assert to_iso(" 2026-01-03 ") == "2026-01-03"
    assert date(1899, 12, 30).isoformat() == to_iso(0)
    with pytest.raises(TypeError):
        to_iso(True)  # noqa: FBT003 - checking that a bool is rejected as a date


def test_parse_lots_splits_held_and_sold_and_stops_at_blank_ticker():
    rows = tab(
        [
            ["AAA", D1, 100, 9500, "", ""],
            ["AAA", D1, 100, 9800, D3, 10_600],
            ["", "", "", "", "", ""],
            ["IGNORED", D1, 1, 1, "", ""],
        ],
        PRICE_ROWS,
    )
    held, sold = parse_lots(rows)
    assert held == [
        {"ticker": "AAA", "acquired": "2026-01-01", "quantity": 100.0, "costBasis": 9500.0}
    ]
    assert sold == [
        {
            "ticker": "AAA",
            "acquired": "2026-01-01",
            "quantity": 100.0,
            "costBasis": 9800.0,
            "sold": "2026-01-03",
            "proceeds": 10_600.0,
        }
    ]


def test_parse_lots_rejects_a_non_numeric_quantity():
    with pytest.raises(TypeError, match="lot row 2 quantity"):
        parse_lots(tab([["AAA", D1, "lots", 9500, "", ""]], PRICE_ROWS))


def test_parse_prices_reads_each_date_close_pair_by_key():
    series = parse_prices(tab([], PRICE_ROWS))
    assert series == {
        "SPX": [("2026-01-01", 1000.0), ("2026-01-02", 1010.0)],
        "AAA": [("2026-01-01", 100.0), ("2026-01-02", 104.0), ("2026-01-03", 108.0)],
    }


def test_parse_prices_needs_the_key_and_prices_labels():
    rows = tab([], PRICE_ROWS)
    rows[1][7] = "Ticker"
    with pytest.raises(ValueError, match="'Key'"):
        parse_prices(rows)


def test_parse_assigned_called_combines_lots_prices_and_latest_date():
    data = parse_assigned_called(tab([["AAA", D1, 100, 9500, "", ""]], PRICE_ROWS))
    assert data["asOf"] == "2026-01-03"
    assert len(data["held"]) == 1
    assert data["sold"] == []
    assert set(data["series"]) == {"SPX", "AAA"}


def test_parse_assigned_called_rejects_an_empty_tab_or_missing_prices():
    with pytest.raises(ValueError, match="empty"):
        parse_assigned_called([])
    with pytest.raises(ValueError, match="no price history"):
        parse_assigned_called(tab([["AAA", D1, 100, 9500, "", ""]], []))


def test_parse_prices_skips_error_cells_and_empty_columns():
    keys = [*KEYS, "BBB", "", "", ""]  # BBB has no data; the blank key column is ignored
    rows = [HEADER, keys, SYMBOLS, PRICES_HDR]
    rows.append(
        ["", "", "", "", "", "", "", "", D1 + CLOSE, 1000, D1 + CLOSE, "#N/A", "#N/A", "#N/A"]
    )
    rows.append(["", "", "", "", "", "", "", "", D2 + CLOSE, 1010, D2 + CLOSE, 104])
    assert parse_prices(rows) == {
        "SPX": [("2026-01-01", 1000.0), ("2026-01-02", 1010.0)],
        "AAA": [("2026-01-02", 104.0)],
    }
