from diff import diff_trades, format_summary


def trade(**over):
    """A trade with sensible defaults; override any field via kwargs."""
    base = {
        "acquired": "Jul 1, 25",
        "expires": "Jul 18, 25",
        "status": "IN PLAY",
        "ticker": "AAPL",
        "contracts": 1,
        "type": "Short Put",
        "premium": 1.0,
        "strike": 180.0,
        "price": 185.0,
        "buffer": 2.5,
        "riskLevel": 100.0,
        "riskCategory": "Safe",
        "duration": 17,
        "estYield": 3.0,
        "closedOn": None,
        "gainLoss": None,
        "capital": 18000.0,
        "realYield": None,
    }
    base.update(over)
    return base


# --- diff_trades: structure -------------------------------------------------


def test_added_trade_is_detected():
    old = [trade(ticker="AAPL")]
    new = [trade(ticker="AAPL"), trade(ticker="MSFT", strike=400.0)]
    d = diff_trades(old, new)
    assert [t["ticker"] for t in d.added] == ["MSFT"]
    assert d.removed == []
    assert d.status_changes == []


def test_removed_trade_is_detected():
    old = [trade(ticker="AAPL"), trade(ticker="FOO", strike=10.0)]
    new = [trade(ticker="AAPL")]
    d = diff_trades(old, new)
    assert [t["ticker"] for t in d.removed] == ["FOO"]
    assert d.added == []


def test_status_change_in_play_to_closed():
    old = [trade(status="IN PLAY")]
    new = [trade(status="CLOSED", closedOn="Jul 15, 25", gainLoss=50.0)]
    d = diff_trades(old, new)
    assert d.added == []
    assert d.removed == []
    assert len(d.status_changes) == 1
    old_status, t = d.status_changes[0]
    assert old_status == "IN PLAY"
    assert t["status"] == "CLOSED"


def test_status_change_to_expired_and_assigned():
    old = [
        trade(ticker="AAPL", status="IN PLAY"),
        trade(ticker="MSFT", strike=400.0, status="IN PLAY"),
    ]
    new = [
        trade(ticker="AAPL", status="EXPIRED"),
        trade(ticker="MSFT", strike=400.0, status="ASSIGNED"),
    ]
    d = diff_trades(old, new)
    changed = {t["ticker"]: t["status"] for _, t in d.status_changes}
    assert changed == {"AAPL": "EXPIRED", "MSFT": "ASSIGNED"}


def test_price_churn_is_not_a_change():
    old = [trade(price=185.0, buffer=2.5, riskLevel=100.0, estYield=3.0, duration=17)]
    new = [trade(price=999.0, buffer=9.9, riskLevel=1.0, estYield=0.1, duration=1)]
    d = diff_trades(old, new)
    assert d.added == []
    assert d.removed == []
    assert d.status_changes == []


def test_realized_field_change_without_status_change_is_silent():
    old = [trade(status="CLOSED", gainLoss=10.0, realYield=1.0, closedOn="Jul 10, 25")]
    new = [trade(status="CLOSED", gainLoss=99.0, realYield=9.0, closedOn="Jul 11, 25")]
    d = diff_trades(old, new)
    assert d.added == []
    assert d.removed == []
    assert d.status_changes == []


def test_duplicate_keys_add_one_more_lot():
    old = [trade(), trade()]  # two identical lots
    new = [trade(), trade(), trade()]  # a third identical lot
    d = diff_trades(old, new)
    assert len(d.added) == 1
    assert d.removed == []


def test_duplicate_keys_remove_one_lot():
    old = [trade(), trade(), trade()]
    new = [trade(), trade()]
    d = diff_trades(old, new)
    assert len(d.removed) == 1
    assert d.added == []


def test_empty_baseline_reports_all_added():
    new = [trade(ticker="AAPL"), trade(ticker="MSFT", strike=400.0)]
    d = diff_trades([], new)
    assert len(d.added) == 2
    assert d.removed == []
    assert d.status_changes == []


# --- format_summary ---------------------------------------------------------


def test_summary_no_changes():
    assert format_summary(diff_trades([trade()], [trade()])) == "No changes since last fetch."


def test_summary_labels_short_put_and_covered_call():
    new = [
        trade(ticker="JPM", strike=280.0, type="Short Put", expires="Jan 16, 26"),
        trade(ticker="AMZN", strike=185.0, type="Covered Call", expires="Feb 6, 26"),
    ]
    out = format_summary(diff_trades([], new))
    assert "+2 new:" in out
    assert "JPM 280P exp Jan 16, 26" in out
    assert "AMZN 185C exp Feb 6, 26" in out


def test_summary_groups_status_changes_by_new_status():
    old = [
        trade(ticker="AAPL", status="IN PLAY"),
        trade(ticker="MSFT", strike=400.0, status="IN PLAY"),
        trade(ticker="NVDA", strike=120.0, status="IN PLAY"),
    ]
    new = [
        trade(ticker="AAPL", status="CLOSED"),
        trade(ticker="MSFT", strike=400.0, status="CLOSED"),
        trade(ticker="NVDA", strike=120.0, status="EXPIRED"),
    ]
    out = format_summary(diff_trades(old, new))
    assert "~2 closed:" in out
    assert "~1 expired:" in out


def test_summary_removed_line():
    old = [trade(ticker="AAPL"), trade(ticker="FOO", strike=10.0)]
    new = [trade(ticker="AAPL")]
    out = format_summary(diff_trades(old, new))
    assert "-1 removed:" in out
    assert "FOO 10P exp Jul 18, 25" in out


def test_summary_truncates_long_lists():
    new = [trade(ticker=f"T{i}", strike=float(i)) for i in range(12)]
    out = format_summary(diff_trades([], new))
    assert "+12 new:" in out
    assert "… (+2 more)" in out
