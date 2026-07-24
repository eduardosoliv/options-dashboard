from pathlib import Path

from normalize import normalize_csv_text

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
