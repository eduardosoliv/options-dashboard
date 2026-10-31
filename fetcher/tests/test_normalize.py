from pathlib import Path

import pytest

from normalize import _formula_terms, normalize_csv_text, normalize_rows

FIXTURE = Path(__file__).parent / "fixtures" / "sample_master.csv"


def load():
    return normalize_csv_text(FIXTURE.read_text(encoding="utf-8"))


def by(trades, ticker, strike, typ, status=None):
    # status disambiguates the two AMZN 280 Covered Calls (one CLOSED, one IN PLAY).
    return next(
        t
        for t in trades
        if t["ticker"] == ticker
        and t["strike"] == strike
        and t["type"] == typ
        and (status is None or t["status"] == status)
    )


def test_row_count_is_148_and_no_summary_rows():
    trades = load()
    assert len(trades) == 148
    assert all(t["ticker"] for t in trades)  # no blank-ticker summary rows
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
    t = by(load(), "AMZN", 280.0, "Covered Call", status="IN PLAY")
    assert t["status"] == "IN PLAY"
    assert t["premium"] == 224.33
    assert t["price"] == 233.74
    assert t["buffer"] == 19.79
    assert t["riskCategory"] == "Safe"  # emoji stripped
    assert t["duration"] == 50
    assert t["estYield"] is None  # blank for covered calls
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


def test_call_spreads_are_skipped():
    header = ["Acquired", "Expires", "Days", "Position", "#", "Column 1", "Type"]
    rows = [
        header,
        ["Jan 2, 26", "Feb 20, 26", "10", "", "1", "AAPL", "Short Put"],
        ["Jan 3, 26", "Feb 20, 26", "10", "", "1", "MSFT", "Call Spread"],
        ["Jan 4, 26", "Feb 20, 26", "10", "", "1", "NVDA", "Bear call spread"],
        ["Jan 5, 26", "Feb 20, 26", "10", "", "1", "AMZN", "Covered Call"],
    ]
    trades = normalize_rows(rows)
    assert [t["ticker"] for t in trades] == ["AAPL", "AMZN"]


def test_exit_terms_parsed_from_gainloss_formula():
    # Rendered values and the same range read as formulas (numbers come back unquoted).
    rows = [
        ["Acquired"],
        ["Nov 17, 25", "Feb 20, 26", "ASSIGNED", "", "1", "MSFT", "Short Put", "", "$435.0"]
        + [""] * 7
        + ["-$3,201.67"],
        ["Jul 20, 26", "Sep 18, 26", "CALLED", "", "1", "VEEV", "Covered Call", "", "$250.0"]
        + [""] * 7
        + ["-$703.66"],
        ["Dec 16, 25", "Jan 16, 26", "CLOSED", "", "2", "JPM", "Short Put", "", "$280.0"]
        + [""] * 7
        + ["$266.62"],
        ["Jan 5, 26", "Feb 6, 26", "CLOSED", "", "1", "GOOGL", "Short Put", "", "$295.0"]
        + [""] * 7
        + ["$197.34"],
    ]
    formulas = [
        ["Acquired"],
        [""] * 16 + ["=-(($E12*100)*($I12-397.85))+(513.33)"],
        [""] * 16 + ["=-(($E128*100)*(260.21-$I128))+(317.34)"],
        [""] * 16 + [266.62],
        [""] * 16 + ["=(317.34)-(120)"],
    ]
    put, call, closed, closed_formula = normalize_rows(rows, formulas)
    assert (put["exitPrice"], put["premiumCollected"]) == (397.85, 513.33)
    assert (call["exitPrice"], call["premiumCollected"]) == (260.21, 317.34)
    assert call["status"] == "CALLED"
    assert (closed["exitPrice"], closed["premiumCollected"], closed["closeCost"]) == (
        None,
        None,
        None,
    )
    assert closed_formula["exitPrice"] is None
    assert (closed_formula["premiumCollected"], closed_formula["closeCost"]) == (317.34, 120.0)
    assert put["closeCost"] is None


def test_exit_terms_absent_without_formulas():
    t = by(load(), "MSFT", 435.0, "Short Put")
    assert t["exitPrice"] is None
    assert t["premiumCollected"] is None


@pytest.mark.parametrize(
    ("formula", "expected"),
    [
        # ASSIGNED put / CALLED call: (exit price, premium, None)
        ("=-(($E12*100)*($I12-397.85))+(513.33)", (397.85, 513.33, None)),
        ("=-(($E128*100)*(260.21-$I128))+(317.34)", (260.21, 317.34, None)),
        ("=-(($E$12*100)*($I$12-397.85))+(513.33)", (397.85, 513.33, None)),
        ("= - ( ( E12 * 100 ) * ( I12 - 397.85 ) ) + ( 513.33 )", (397.85, 513.33, None)),
        # CLOSED / EXPIRED premium minus buyback: (None, premium, cost)
        ("=(278.67)-(12.05)", (None, 278.67, 12.05)),
        ("=278.67-12.05", (None, 278.67, 12.05)),
        ("=(238.65)-(0)", (None, 238.65, 0.0)),
        # Anything else is ignored rather than guessed at.
        ("=SUM(Q3:Q225)", (None, None, None)),
        ("=(278.67)+(12.05)", (None, None, None)),
        ("=-(($E12*100)*($I12-397.85))", (None, None, None)),
        (266.62, (None, None, None)),
        ("", (None, None, None)),
        (None, (None, None, None)),
    ],
)
def test_formula_terms(formula, expected):
    assert _formula_terms(formula) == expected


def test_formula_rows_shorter_than_rendered_rows():
    # A missing/short formula row must not break normalization.
    rows = [["Acquired"], ["Jan 2, 26", "Feb 20, 26", "CLOSED", "", "1", "AAPL", "Short Put"]]
    (t,) = normalize_rows(rows, [["Acquired"]])
    assert (t["exitPrice"], t["premiumCollected"], t["closeCost"]) == (None, None, None)
