import json
import pytest
from fetch_trades import write_json_atomic, write_trades


def test_atomic_write_roundtrips(tmp_path):
    p = tmp_path / "trades.json"
    write_json_atomic(str(p), [{"ticker": "JPM"}])
    assert json.loads(p.read_text()) == [{"ticker": "JPM"}]
    assert not (tmp_path / "trades.json.tmp").exists()   # temp cleaned up


def test_write_trades_refuses_empty_and_keeps_existing(tmp_path):
    p = tmp_path / "trades.json"
    write_trades(str(p), [{"ticker": "OLD"}])
    with pytest.raises(ValueError):
        write_trades(str(p), [])                          # empty -> refuse
    assert json.loads(p.read_text()) == [{"ticker": "OLD"}]  # untouched
