import json

import pytest

import fetch_trades
from fetch_trades import (
    ConfigError,
    parse_benchmarks,
    read_existing_trades,
    write_json_atomic,
    write_trades,
)


def test_atomic_write_roundtrips(tmp_path):
    p = tmp_path / "trades.json"
    write_json_atomic(str(p), [{"ticker": "JPM"}])
    assert json.loads(p.read_text()) == [{"ticker": "JPM"}]
    assert not (tmp_path / "trades.json.tmp").exists()  # temp cleaned up


def test_write_trades_refuses_empty_and_keeps_existing(tmp_path):
    p = tmp_path / "trades.json"
    write_trades(str(p), [{"ticker": "OLD"}])
    with pytest.raises(ValueError, match="0 trades"):
        write_trades(str(p), [])  # empty -> refuse
    assert json.loads(p.read_text()) == [{"ticker": "OLD"}]  # untouched


def test_read_existing_trades_roundtrips(tmp_path):
    p = tmp_path / "trades.json"
    write_json_atomic(str(p), [{"ticker": "JPM"}])
    assert read_existing_trades(str(p)) == [{"ticker": "JPM"}]


def test_read_existing_trades_missing_returns_empty(tmp_path):
    assert read_existing_trades(str(tmp_path / "nope.json")) == []


def test_read_existing_trades_garbage_returns_empty(tmp_path):
    p = tmp_path / "trades.json"
    p.write_text("not json {", encoding="utf-8")
    assert read_existing_trades(str(p)) == []


ROW = ["Nov 17, 25", "Feb 20, 26", "ASSIGNED", "", "1", "MSFT", "Short Put", "", "$435.0"]
ROW += [""] * 7 + ["-$3,201.67"]
FORMULA_ROW = [""] * 16 + ["=-(($E2*100)*($I2-397.85))+(513.33)"]


def _patch_sheet(monkeypatch, tmp_path, fetch_rows):
    out = tmp_path / "trades.json"
    monkeypatch.setattr(fetch_trades, "load_config", lambda: ("sid", "Master", str(out)))
    monkeypatch.setattr(fetch_trades, "load_benchmarks", lambda: None)
    monkeypatch.setattr(fetch_trades, "get_creds", lambda *_: object())
    monkeypatch.setattr(fetch_trades, "fetch_rows", fetch_rows)
    return out


def test_main_reads_formulas_into_exit_fields(monkeypatch, tmp_path):
    renders = []

    def fake_fetch_rows(_creds, _sid, _range, render="FORMATTED_VALUE"):
        renders.append(render)
        return [["Acquired"], FORMULA_ROW] if render == "FORMULA" else [["Acquired"], ROW]

    out = _patch_sheet(monkeypatch, tmp_path, fake_fetch_rows)
    assert fetch_trades.main() == 0
    assert renders == ["FORMATTED_VALUE", "FORMULA"]
    (t,) = json.loads(out.read_text())
    assert (t["exitPrice"], t["premiumCollected"], t["gainLoss"]) == (397.85, 513.33, -3201.67)


def test_main_keeps_existing_file_when_formula_read_fails(monkeypatch, tmp_path):
    def fake_fetch_rows(_creds, _sid, _range, render="FORMATTED_VALUE"):
        if render == "FORMULA":
            raise RuntimeError("quota exceeded")
        return [["Acquired"], ROW]

    out = _patch_sheet(monkeypatch, tmp_path, fake_fetch_rows)
    out.write_text('[{"ticker": "GOOD"}]')
    assert fetch_trades.main() == 1
    assert json.loads(out.read_text()) == [{"ticker": "GOOD"}]


def _ok_rows(_creds, _sid, _range, render="FORMATTED_VALUE"):
    return [["Acquired"], FORMULA_ROW] if render == "FORMULA" else [["Acquired"], ROW]


def test_parse_benchmarks_absent_returns_none():
    assert parse_benchmarks({"spreadsheet_id": "sid"}) is None


def test_parse_benchmarks_reads_returns_and_period():
    cfg = {"benchmarks": {"put_return": 7.5, "tbill_return": 4, "period": " Jan 2025 - Oct 2026 "}}
    assert parse_benchmarks(cfg) == {
        "putReturn": 7.5,
        "tbillReturn": 4.0,
        "period": "Jan 2025 - Oct 2026",
    }


def test_parse_benchmarks_allows_partial_table():
    assert parse_benchmarks({"benchmarks": {"put_return": -1.25}}) == {
        "putReturn": -1.25,
        "tbillReturn": None,
        "period": None,
    }


@pytest.mark.parametrize("bad", ["7.5%", True, [7.5]])
def test_parse_benchmarks_rejects_non_numbers(bad):
    with pytest.raises(ConfigError, match="put_return"):
        parse_benchmarks({"benchmarks": {"put_return": bad}})


def test_parse_benchmarks_rejects_non_table():
    with pytest.raises(ConfigError, match="table"):
        parse_benchmarks({"benchmarks": 7.5})


def test_main_writes_benchmarks_next_to_trades(monkeypatch, tmp_path):
    out = _patch_sheet(monkeypatch, tmp_path, _ok_rows)
    bench = {"putReturn": 7.5, "tbillReturn": 4.0, "period": "2025-2026"}
    monkeypatch.setattr(fetch_trades, "load_benchmarks", lambda: bench)
    assert fetch_trades.main() == 0
    assert json.loads((tmp_path / "benchmarks.json").read_text()) == bench
    assert len(json.loads(out.read_text())) == 1


def test_main_skips_benchmarks_when_unset(monkeypatch, tmp_path):
    _patch_sheet(monkeypatch, tmp_path, _ok_rows)
    assert fetch_trades.main() == 0
    assert not (tmp_path / "benchmarks.json").exists()


def test_main_bad_benchmarks_warn_but_still_write_trades(monkeypatch, tmp_path, capsys):
    out = _patch_sheet(monkeypatch, tmp_path, _ok_rows)

    def bad_benchmarks():
        raise ConfigError("benchmarks.put_return must be a number")

    monkeypatch.setattr(fetch_trades, "load_benchmarks", bad_benchmarks)
    assert fetch_trades.main() == 0
    assert "WARNING: skipping benchmarks.json" in capsys.readouterr().err
    assert len(json.loads(out.read_text())) == 1
    assert not (tmp_path / "benchmarks.json").exists()


CONFIG_TOML = """
spreadsheet_id = "sid"
sheet_range = "Master"
output_path = "web/dist/trades.json"

[benchmarks]
period = "1Y to Sep 30, 2026"
put_return = 15.2   # Cboe S&P 500 PutWrite Index (PUT)
tbill_return = 4    # integer percent is fine
"""


def test_load_benchmarks_reads_config_toml(monkeypatch, tmp_path):
    cfg = tmp_path / "config.toml"
    cfg.write_text(CONFIG_TOML, encoding="utf-8")
    monkeypatch.setattr(fetch_trades, "CONFIG_PATH", cfg)
    assert fetch_trades.load_benchmarks() == {
        "putReturn": 15.2,
        "tbillReturn": 4.0,
        "period": "1Y to Sep 30, 2026",
    }
    # The [benchmarks] table doesn't disturb the top-level keys.
    assert fetch_trades.load_config()[:2] == ("sid", "Master")


def test_load_benchmarks_none_without_table(monkeypatch, tmp_path):
    cfg = tmp_path / "config.toml"
    cfg.write_text('spreadsheet_id = "sid"\n', encoding="utf-8")
    monkeypatch.setattr(fetch_trades, "CONFIG_PATH", cfg)
    assert fetch_trades.load_benchmarks() is None


def test_load_benchmarks_missing_config_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(fetch_trades, "CONFIG_PATH", tmp_path / "nope.toml")
    with pytest.raises(ConfigError, match="no config file"):
        fetch_trades.load_benchmarks()


def test_benchmarks_json_matches_dashboard_keys(monkeypatch, tmp_path):
    # The dashboard reads exactly these camelCase keys from benchmarks.json.
    _patch_sheet(monkeypatch, tmp_path, _ok_rows)
    monkeypatch.setattr(
        fetch_trades,
        "load_benchmarks",
        lambda: parse_benchmarks({"benchmarks": {"put_return": 15.2, "tbill_return": 4.0}}),
    )
    assert fetch_trades.main() == 0
    written = json.loads((tmp_path / "benchmarks.json").read_text())
    assert set(written) == {"putReturn", "tbillReturn", "period"}
