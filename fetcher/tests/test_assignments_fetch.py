import json

import httplib2
import pytest
from googleapiclient.errors import HttpError

import fetch_trades
from tests.test_assignments import D1, PRICE_ROWS, tab

GOOD_TAB = tab([["AAA", D1, 100, 9500, "", ""]], PRICE_ROWS)


def http_error(status):
    return HttpError(httplib2.Response({"status": status}), b"Unable to parse range: Nope")


def _patch(monkeypatch, rows_or_error):
    monkeypatch.setattr(fetch_trades, "load_assignments_range", lambda: "AssignedCalled")

    def fake_fetch_rows(_creds, _sid, tab_name, render, date_render):
        assert (tab_name, render, date_render) == (
            "AssignedCalled",
            "UNFORMATTED_VALUE",
            "SERIAL_NUMBER",
        )
        if isinstance(rows_or_error, Exception):
            raise rows_or_error
        return rows_or_error

    monkeypatch.setattr(fetch_trades, "fetch_rows", fake_fetch_rows)


def test_fetch_assignment_rows_returns_none_for_a_missing_tab(monkeypatch):
    _patch(monkeypatch, http_error(400))
    assert fetch_trades.fetch_assignment_rows(object(), "sid", "AssignedCalled") is None


def test_fetch_assignment_rows_reraises_other_http_errors(monkeypatch):
    _patch(monkeypatch, http_error(403))
    with pytest.raises(HttpError):
        fetch_trades.fetch_assignment_rows(object(), "sid", "AssignedCalled")


def test_update_assignments_writes_next_to_trades(monkeypatch, tmp_path, capsys):
    _patch(monkeypatch, GOOD_TAB)
    fetch_trades.update_assignments(object(), "sid", str(tmp_path / "trades.json"))
    data = json.loads((tmp_path / "assignments.json").read_text())
    assert data["asOf"] == "2026-01-03"
    assert data["held"][0]["costBasis"] == 9500
    assert data["series"]["AAA"][0] == ["2026-01-01", 100]
    assert "OK: wrote 1 lots and 2 price series" in capsys.readouterr().out


def test_update_assignments_only_warns_when_the_tab_is_missing(monkeypatch, tmp_path, capsys):
    _patch(monkeypatch, http_error(400))
    fetch_trades.update_assignments(object(), "sid", str(tmp_path / "trades.json"))
    assert not (tmp_path / "assignments.json").exists()
    assert "WARNING: no 'AssignedCalled' tab" in capsys.readouterr().err


def test_update_assignments_keeps_the_last_good_file_on_a_bad_tab(monkeypatch, tmp_path, capsys):
    good = tmp_path / "assignments.json"
    good.write_text('{"asOf": "GOOD"}')
    _patch(monkeypatch, [["just", "a", "header"]])
    fetch_trades.update_assignments(object(), "sid", str(tmp_path / "trades.json"))
    assert json.loads(good.read_text()) == {"asOf": "GOOD"}
    assert "WARNING: skipping assignments.json" in capsys.readouterr().err


def test_update_assignments_never_raises(monkeypatch, tmp_path, capsys):
    _patch(monkeypatch, RuntimeError("quota exceeded"))
    fetch_trades.update_assignments(object(), "sid", str(tmp_path / "trades.json"))
    assert "quota exceeded" in capsys.readouterr().err


def test_main_updates_assignments_after_writing_trades(monkeypatch, tmp_path):
    out = tmp_path / "trades.json"
    calls = []
    monkeypatch.setattr(fetch_trades, "load_config", lambda: ("sid", "Master", str(out)))
    monkeypatch.setattr(fetch_trades, "load_benchmarks", lambda: None)
    monkeypatch.setattr(fetch_trades, "get_creds", lambda *_: "creds")
    monkeypatch.setattr(
        fetch_trades, "fetch_rows", lambda *_a, **_k: [["Acquired"], ["Nov 17, 25"]]
    )
    monkeypatch.setattr(fetch_trades, "normalize_rows", lambda *_: [{"ticker": "AAA"}])
    monkeypatch.setattr(
        fetch_trades, "update_assignments", lambda *a: calls.append((a, out.exists()))
    )
    assert fetch_trades.main() == 0
    assert calls == [(("creds", "sid", str(out)), True)]


def test_load_assignments_range_defaults_to_assigned_called(monkeypatch, tmp_path):
    cfg = tmp_path / "config.toml"
    cfg.write_text('spreadsheet_id = "x"\n')
    monkeypatch.setattr(fetch_trades, "CONFIG_PATH", cfg)
    assert fetch_trades.load_assignments_range() == "AssignedCalled"
    cfg.write_text('spreadsheet_id = "x"\nassignments_range = "Lots"\n')
    assert fetch_trades.load_assignments_range() == "Lots"
