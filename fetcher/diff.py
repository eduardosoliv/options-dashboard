"""Compare two trade lists and summarize meaningful changes for the CLI.

"Meaningful" excludes live/price/realized fields (they churn on every fetch via
GOOGLEFINANCE): only positions opening (added), disappearing (removed), or
flipping `status` are reported.
"""

from collections import Counter
from dataclasses import dataclass, field

from normalize import Trade

# Fields fixed when a position opens -> identity of a trade across fetches.
# Everything else (price, buffer, riskLevel, estYield, duration, gainLoss,
# realYield, closedOn, status) is deliberately excluded from the match key.
KEY_FIELDS = ("acquired", "expires", "ticker", "type", "strike", "contracts")

# How many trades to name per line before collapsing the rest into "(+N more)".
_MAX_LISTED = 10


@dataclass
class TradesDiff:
    """Meaningful changes between a previous and current trade list."""

    added: list[Trade] = field(default_factory=list)
    removed: list[Trade] = field(default_factory=list)
    # (old_status, current_trade) for matched trades whose status flipped.
    status_changes: list[tuple[str | None, Trade]] = field(default_factory=list)

    @property
    def has_changes(self) -> bool:
        return bool(self.added or self.removed or self.status_changes)


def _key(trade: Trade) -> tuple[object, ...]:
    return tuple(trade[f] for f in KEY_FIELDS)


def _index(trades: list[Trade]) -> dict[tuple[object, ...], Trade]:
    """Map each trade to a unique key, disambiguating identical lots by index."""
    seen: Counter[tuple[object, ...]] = Counter()
    indexed: dict[tuple[object, ...], Trade] = {}
    for t in trades:
        base = _key(t)
        indexed[(*base, seen[base])] = t
        seen[base] += 1
    return indexed


def diff_trades(old: list[Trade], new: list[Trade]) -> TradesDiff:
    old_index = _index(old)
    new_index = _index(new)

    result = TradesDiff()
    for key, t in new_index.items():
        if key not in old_index:
            result.added.append(t)
        elif (old_status := old_index[key]["status"]) != t["status"]:
            result.status_changes.append((None if old_status is None else str(old_status), t))
    result.removed.extend(t for key, t in old_index.items() if key not in new_index)
    return result


_TYPE_ABBR = {"Short Put": "P", "Covered Call": "C"}


def _fmt_strike(strike: object) -> str:
    if isinstance(strike, float) and strike.is_integer():
        return str(int(strike))
    return str(strike)


def _label(trade: Trade) -> str:
    ticker = trade["ticker"] or "?"
    strike = _fmt_strike(trade["strike"])
    kind = _TYPE_ABBR.get(str(trade["type"]), str(trade["type"]))
    return f"{ticker} {strike}{kind} exp {trade['expires']}"


def _list_line(prefix: str, trades: list[Trade]) -> str:
    shown = [_label(t) for t in trades[:_MAX_LISTED]]
    extra = len(trades) - _MAX_LISTED
    if extra > 0:
        shown.append(f"… (+{extra} more)")
    return f"  {prefix}: {', '.join(shown)}"


def format_summary(diff: TradesDiff) -> str:
    if not diff.has_changes:
        return "No changes since last fetch."

    lines: list[str] = []
    if diff.added:
        lines.append(_list_line(f"+{len(diff.added)} new", diff.added))

    by_status: dict[str, list[Trade]] = {}
    for _, t in diff.status_changes:
        by_status.setdefault(str(t["status"]).lower(), []).append(t)
    for status, trades in by_status.items():
        lines.append(_list_line(f"~{len(trades)} {status}", trades))

    if diff.removed:
        lines.append(_list_line(f"-{len(diff.removed)} removed", diff.removed))

    return "\n".join(lines)
