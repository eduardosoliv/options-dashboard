import json

import pytest

import fetch_trades
from fetch_trades import read_existing_trades, write_json_atomic, write_trades


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
