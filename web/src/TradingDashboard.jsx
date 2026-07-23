import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend, AreaChart, Area, LabelList, ComposedChart, Line, ErrorBar } from 'recharts';
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, AlertTriangle, Search, ArrowUpDown, ChevronDown, Trophy } from 'lucide-react';


// Helper functions
const fmtCurrency = (n) => {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtCurrencyWhole = (n) => {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};
const fmtPct = (n) => n === null || n === undefined ? '—' : `${n.toFixed(2)}%`;
const bufferIcon = (category) => {
  if (category === 'Very Safe') return '✅';
  if (category === 'Safe') return '🟢';
  if (category === 'Alert') return '⚠️';
  if (category === 'Danger') return '❗';
  if (category === 'ITM' || category === 'Deep ITM') return '🔴';
  return '';
};

// Shared chart tooltip styles — used by all recharts Tooltips so text is always readable on dark bg
const TOOLTIP_STYLE = {
  contentStyle: { background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' },
  labelStyle: { color: '#fafafa', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: '#e4e4e7' },
};
const parseDate = (s) => {
  if (!s) return null;
  const [mon, day, yr] = s.replace(',', '').split(' ');
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  return new Date(2000 + parseInt(yr), months[mon], parseInt(day));
};

const isWin = (t) => t.gainLoss > 0;
const isLoss = (t) => t.gainLoss < 0;
const isClosed = (t) => t.status !== 'IN PLAY';

export default function TradingDashboard({ tradesData }) {
  const TRADES = tradesData;
  const [statusFilter, setStatusFilter] = useState('in_play'); // all, in_play, closed
  const [outcomeFilter, setOutcomeFilter] = useState('all'); // all, won, lost (only when closed)
  const [bufferLevels, setBufferLevels] = useState(['Very Safe', 'Safe', 'Alert', 'Danger', 'ITM', 'Deep ITM']); // multi-select, in-play only
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('expires');
  const [sortDir, setSortDir] = useState('asc');
  const [activeView, setActiveView] = useState('overview'); // overview, charts, puts, calls
  const [yieldSortKey, setYieldSortKey] = useState('annYield');
  const [yieldSortDir, setYieldSortDir] = useState('desc');


  // Filter trades by strategy type
  const getFilteredTrades = (strategyType) => {
    let result = TRADES.filter(t => t.type === strategyType);
    if (statusFilter === 'in_play') {
      result = result.filter(t => t.status === 'IN PLAY');
      // Apply buffer level filter only when looking at in-play
      if (bufferLevels.length < 6) {
        result = result.filter(t => bufferLevels.includes(t.riskCategory));
      }
    }
    if (statusFilter === 'closed') {
      result = result.filter(t => t.status !== 'IN PLAY');
      if (outcomeFilter === 'won') result = result.filter(isWin);
      if (outcomeFilter === 'lost') result = result.filter(isLoss);
    }
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      result = result.filter(t => t.ticker.includes(q));
    }
    // sort
    const catRank = { 'Very Safe': 5, 'Safe': 4, 'Alert': 3, 'Danger': 2, 'ITM': 1, 'Deep ITM': 0 };
    result.sort((a, b) => {
      let av, bv;
      if (sortKey === 'premium') {
        // Premium for in-play, realized P&L for closed — sort by whichever the row shows
        av = a.status === 'IN PLAY' ? a.premium : a.gainLoss;
        bv = b.status === 'IN PLAY' ? b.premium : b.gainLoss;
      } else if (sortKey === 'estYield') {
        av = a.status === 'IN PLAY' ? a.estYield : a.realYield;
        bv = b.status === 'IN PLAY' ? b.estYield : b.realYield;
      } else if (sortKey === 'riskCategory') {
        av = catRank[a.riskCategory] ?? -1;
        bv = catRank[b.riskCategory] ?? -1;
      } else {
        av = a[sortKey];
        bv = b[sortKey];
      }
      if (sortKey === 'expires' || sortKey === 'acquired' || sortKey === 'closedOn') {
        av = parseDate(av)?.getTime() ?? 0;
        bv = parseDate(bv)?.getTime() ?? 0;
      }
      if (av === undefined || av === null) av = -Infinity;
      if (bv === undefined || bv === null) bv = -Infinity;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return result;
  };

  const putsTrades = useMemo(() => getFilteredTrades('Short Put'), [statusFilter, outcomeFilter, bufferLevels, search, sortKey, sortDir]);
  const callsTrades = useMemo(() => getFilteredTrades('Covered Call'), [statusFilter, outcomeFilter, bufferLevels, search, sortKey, sortDir]);

  // Aggregate stats
  const stats = useMemo(() => {
    const closed = TRADES.filter(isClosed);
    const inPlay = TRADES.filter(t => t.status === 'IN PLAY');
    const wins = closed.filter(isWin);
    const losses = closed.filter(isLoss);
    const totalGain = closed.reduce((s,t) => s + t.gainLoss, 0);
    const totalWinAmount = wins.reduce((s,t) => s + t.gainLoss, 0);
    const totalLossAmount = losses.reduce((s,t) => s + t.gainLoss, 0);
    const premiumInPlay = inPlay.reduce((s,t) => s + (t.premium || 0), 0);
    const riskInPlay = inPlay.reduce((s,t) => s + (t.riskLevel || 0), 0);
    const inPlayShortPuts = inPlay.filter(t => t.type === 'Short Put').length;
    const inPlayCoveredCalls = inPlay.filter(t => t.type === 'Covered Call').length;
    const inPlay2026 = inPlay.filter(t => { const d = parseDate(t.expires); return d && d.getFullYear() === 2026; }).length;
    const inPlayBeyond2026 = inPlay.length - inPlay2026;
    const premiumInPlay2026 = inPlay.filter(t => { const d = parseDate(t.expires); return d && d.getFullYear() === 2026; }).reduce((s,t) => s + (t.premium || 0), 0);
    return {
      totalTrades: TRADES.length,
      closed: closed.length,
      inPlay: inPlay.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? (wins.length / closed.length * 100) : 0,
      totalGain,
      avgWin: wins.length ? totalWinAmount / wins.length : 0,
      avgLoss: losses.length ? totalLossAmount / losses.length : 0,
      premiumInPlay,
      riskInPlay,
      inPlayShortPuts,
      inPlayCoveredCalls,
      inPlay2026,
      inPlayBeyond2026,
      premiumInPlay2026,
    };
  }, []);

  // Charts data
  const tickerPnL = useMemo(() => {
    const map = {};
    TRADES.filter(isClosed).forEach(t => {
      map[t.ticker] = (map[t.ticker] || 0) + t.gainLoss;
    });
    return Object.entries(map)
      .map(([ticker, pnl]) => ({ ticker, pnl: Math.round(pnl * 100) / 100 }))
      .sort((a, b) => b.pnl - a.pnl);
  }, []);

  // Realized P&L split by strategy (Short Put vs Covered Call)
  const strategyPnL = useMemo(() => {
    const map = {};
    TRADES.filter(isClosed).forEach(t => {
      if (!map[t.type]) map[t.type] = { gains: 0, losses: 0, net: 0, count: 0 };
      map[t.type].net += t.gainLoss;
      map[t.type].count += 1;
      if (t.gainLoss > 0) map[t.type].gains += t.gainLoss;
      else map[t.type].losses += t.gainLoss;
    });
    const order = ['Short Put', 'Covered Call'];
    return order.filter(k => map[k]).map(k => ({
      name: k === 'Short Put' ? 'Short Puts' : 'Covered Calls',
      gains: Math.round(map[k].gains * 100) / 100,
      losses: Math.round(map[k].losses * 100) / 100,
      net: Math.round(map[k].net * 100) / 100,
      count: map[k].count,
    }));
  }, []);

  // Monthly realized P&L + cumulative equity curve + forecast from current book
  const monthlyPnL = useMemo(() => {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const map = {};
    TRADES.filter(isClosed).filter(t => t.closedOn).forEach(t => {
      const d = parseDate(t.closedOn);
      if (!d) return;
      const key = d.getFullYear() * 100 + d.getMonth();
      if (!map[key]) map[key] = { key, label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, pnl: 0, count: 0 };
      map[key].pnl += t.gainLoss;
      map[key].count += 1;
    });
    const sorted = Object.values(map).sort((a, b) => a.key - b.key);
    let cum = 0;
    const rows = sorted.map(m => {
      cum += m.pnl;
      return {
        month: m.label,
        key: m.key,
        pnl: Math.round(m.pnl * 100) / 100,
        cumulative: Math.round(cum * 100) / 100,
        count: m.count,
      };
    });

    // Forecast: expected premium capture of the current in-play book, by expiry month.
    // central = P(OTM)-weighted; low = stressed probs + 5% further drop on assignments; high = full capture.
    // Behavioral adjustments:
    //  · CAPTURE = 0.85 — positions are typically closed at ~85% of max profit, not held for the last dollar.
    //  · EARLY_SPLIT — half of each position's expected capture is realized ~4 weeks early (booked in the
    //    prior month), reflecting the habit of closing sooner / peeling off higher-strike legs to de-risk.
    const CAPTURE = 0.85;
    const EARLY_SPLIT = 0.5;
    const P = { 'Very Safe': 0.95, 'Safe': 0.85, 'Alert': 0.65, 'Danger': 0.40, 'ITM': 0.20, 'Deep ITM': 0.05 };
    const P_LOW = { 'Very Safe': 0.85, 'Safe': 0.65, 'Alert': 0.40, 'Danger': 0.20, 'ITM': 0.05, 'Deep ITM': 0.02 };
    const priorMonthKey = (key) => {
      let y = Math.floor(key / 100), m = key % 100;
      m -= 1; if (m < 0) { m = 11; y -= 1; }
      return y * 100 + m;
    };
    // Don't let the early-close split push premium into an already-realized month.
    const lastRealizedKey = rows.length ? rows[rows.length - 1].key : null;
    const clampKey = (key) => {
      if (lastRealizedKey === null) return key;
      const ord = Math.floor(key / 100) * 12 + (key % 100);
      const lastOrd = Math.floor(lastRealizedKey / 100) * 12 + (lastRealizedKey % 100);
      return ord < lastOrd ? lastRealizedKey : key;
    };
    const ensureFmap = (fmap, key) => {
      if (!fmap[key]) fmap[key] = { key, label: `${MONTHS[key % 100]} ${String(Math.floor(key / 100)).slice(2)}`, central: 0, low: 0, high: 0 };
      return fmap[key];
    };
    const fmap = {};
    TRADES.filter(t => t.status === 'IN PLAY').forEach(t => {
      const d = parseDate(t.expires);
      if (!d) return;
      const key = d.getFullYear() * 100 + d.getMonth();
      const kPrior = clampKey(priorMonthKey(key));
      const prem = t.premium || 0;
      let central, low, high;
      if (t.type === 'Covered Call') {
        central = prem * CAPTURE; low = prem * CAPTURE; high = prem;
      } else {
        const p = P[t.riskCategory] ?? 0.5;
        const pl = P_LOW[t.riskCategory] ?? 0.3;
        const intrinsic = Math.max(0, t.strike - t.price) * 100 * t.contracts;
        const stressed = Math.max(0, t.strike - t.price * 0.95) * 100 * t.contracts;
        central = (p * prem + (1 - p) * (intrinsic > 0 ? prem - intrinsic : 0)) * CAPTURE;
        low = (pl * prem + (1 - pl) * Math.min(prem - stressed, 0)) * CAPTURE;
        high = prem;
      }
      // Split: EARLY_SPLIT booked one month earlier, remainder in the expiry month.
      const dst = ensureFmap(fmap, key);
      const src = ensureFmap(fmap, kPrior);
      src.central += central * EARLY_SPLIT; src.low += low * EARLY_SPLIT; src.high += high * EARLY_SPLIT;
      dst.central += central * (1 - EARLY_SPLIT); dst.low += low * (1 - EARLY_SPLIT); dst.high += high * (1 - EARLY_SPLIT);
    });
    let fsorted = Object.values(fmap).sort((a, b) => a.key - b.key);
    // Cap forecast horizon at 6 months past the last realized month
    if (rows.length) {
      const lastKey = rows[rows.length - 1].key;
      const lastY = Math.floor(lastKey / 100), lastM = lastKey % 100;
      const cutoff = (lastY * 12 + lastM) + 6;
      fsorted = fsorted.filter(f => (Math.floor(f.key / 100) * 12 + (f.key % 100)) <= cutoff);
    }
    if (rows.length && fsorted.length) {
      // Anchor the forecast line/band at the last realized month so the dashed
      // line starts there (e.g. June), not the month before.
      const last = rows[rows.length - 1];
      let cumC = last.cumulative, cumL = last.cumulative, cumH = last.cumulative;
      const firstIsCurrent = fsorted[0].key === last.key;
      // Anchor the dashed forecast line at the last realized month's cumulative so
      // it hands off cleanly from the solid line (e.g. at June).
      last.cumCentral = last.cumulative;
      last.cumRange = [last.cumulative, last.cumulative];
      fsorted.forEach(f => {
        const existing = rows.find(r => r.key === f.key);
        if (existing && existing.pnl !== undefined) {
          // Current (partial) month: stack the month's own forecast onto the realized
          // bar for the dot/whisker, but leave the cumulative line anchored at realized
          // (its remaining forecast flows into next month's cumulative step).
          const base = existing.pnl;
          existing.forecastPnl = Math.round((base + f.central) * 100) / 100;
          existing.fLow = Math.round(f.low * 100) / 100;
          existing.fHigh = Math.round(f.high * 100) / 100;
          existing.forecastErr = [Math.round((f.central - f.low) * 100) / 100, Math.round((f.high - f.central) * 100) / 100];
          cumC += f.central; cumL += f.low; cumH += f.high;
        } else {
          cumC += f.central; cumL += f.low; cumH += f.high;
          const vals = {
            forecastPnl: Math.round(f.central * 100) / 100,
            fLow: Math.round(f.low * 100) / 100,
            fHigh: Math.round(f.high * 100) / 100,
            forecastRange: [Math.round(f.low * 100) / 100, Math.round(f.high * 100) / 100],
            forecastErr: [Math.round((f.central - f.low) * 100) / 100, Math.round((f.high - f.central) * 100) / 100],
            cumCentral: Math.round(cumC * 100) / 100,
            cumRange: [Math.round(cumL * 100) / 100, Math.round(cumH * 100) / 100],
          };
          rows.push({ month: f.label, key: f.key, isForecast: true, ...vals });
        }
      });
    }
    return rows;
  }, []);

  // All trades that closed at a loss, worst first
  const losingTrades = useMemo(() => {
    return TRADES
      .filter(t => isClosed(t) && typeof t.gainLoss === 'number' && t.gainLoss < 0)
      .slice()
      .sort((a, b) => a.gainLoss - b.gainLoss);
  }, []);

  // Short puts that were assigned (i.e. resulted in share ownership)
  const assignedPuts = useMemo(() => {
    return TRADES
      .filter(t => t.status === 'ASSIGNED' && t.type === 'Short Put')
      .map(t => ({ ...t, shares: t.contracts * 100 }))
      .sort((a, b) => (parseDate(b.closedOn) || 0) - (parseDate(a.closedOn) || 0));
  }, []);

  // Short puts: expired/closed worthless vs assigned
  const putOutcomeSplit = useMemo(() => {
    const closedPuts = TRADES.filter(t => isClosed(t) && t.type === 'Short Put');
    const assigned = closedPuts.filter(t => t.status === 'ASSIGNED').length;
    const expired = closedPuts.length - assigned;
    return [
      { name: 'Expired', value: expired, fill: '#34d399' },
      { name: 'Assigned', value: assigned, fill: '#f59e0b' },
    ];
  }, []);

  // Short puts: won vs lost
  const putWinLossSplit = useMemo(() => {
    const closedPuts = TRADES.filter(t => isClosed(t) && t.type === 'Short Put' && typeof t.gainLoss === 'number');
    const won = closedPuts.filter(t => t.gainLoss > 0).length;
    const lost = closedPuts.filter(t => t.gainLoss < 0).length;
    return [
      { name: 'Won', value: won, fill: '#34d399' },
      { name: 'Lost', value: lost, fill: '#fb7185' },
    ];
  }, []);

  // Short puts: net realized P&L by ticker
  const putPnLByTicker = useMemo(() => {
    const map = {};
    TRADES.filter(t => isClosed(t) && t.type === 'Short Put' && typeof t.gainLoss === 'number')
      .forEach(t => { map[t.ticker] = (map[t.ticker] || 0) + t.gainLoss; });
    return Object.entries(map)
      .map(([ticker, pnl]) => ({ ticker, pnl: Math.round(pnl * 100) / 100 }))
      .sort((a, b) => b.pnl - a.pnl);
  }, []);

  // Per-trade computed yields for closed short puts (annualized, calculated — not from source data)
  const putYields = useMemo(() => {
    return TRADES
      .filter(t => isClosed(t) && t.type === 'Short Put' && typeof t.gainLoss === 'number')
      .map(t => {
        const dAcq = parseDate(t.acquired);
        const dClose = parseDate(t.closedOn);
        const days = (dAcq && dClose) ? Math.max(1, Math.round((dClose - dAcq) / 86400000)) : null;
        const capital = t.capital || (t.strike * 100 * t.contracts);
        const simpleYield = capital > 0 ? (t.gainLoss / capital) * 100 : null;
        const annYield = (days && capital > 0) ? (t.gainLoss / capital) * (365 / days) * 100 : null;
        return {
          ticker: t.ticker, strike: t.strike, contracts: t.contracts,
          acquired: t.acquired, closedOn: t.closedOn, days,
          gainLoss: t.gainLoss, capital, simpleYield, annYield,
        };
      })
      .sort((a, b) => (b.annYield ?? -Infinity) - (a.annYield ?? -Infinity));
  }, []);

  // All covered calls that have closed (always rolled — no shares sold), worst-to-best by date
  const closedCalls = useMemo(() => {
    return TRADES
      .filter(t => isClosed(t) && t.type === 'Covered Call')
      .slice()
      .sort((a, b) => (parseDate(b.closedOn) || 0) - (parseDate(a.closedOn) || 0));
  }, []);

  // Covered calls: won vs lost
  const callWinLossSplit = useMemo(() => {
    const cc = TRADES.filter(t => isClosed(t) && t.type === 'Covered Call' && typeof t.gainLoss === 'number');
    const won = cc.filter(t => t.gainLoss > 0).length;
    const lost = cc.filter(t => t.gainLoss < 0).length;
    return [
      { name: 'Won', value: won, fill: '#34d399' },
      { name: 'Lost', value: lost, fill: '#fb7185' },
    ];
  }, []);

  // Covered calls: net realized P&L by ticker
  const callPnLByTicker = useMemo(() => {
    const map = {};
    TRADES.filter(t => isClosed(t) && t.type === 'Covered Call' && typeof t.gainLoss === 'number')
      .forEach(t => { map[t.ticker] = (map[t.ticker] || 0) + t.gainLoss; });
    return Object.entries(map)
      .map(([ticker, pnl]) => ({ ticker, pnl: Math.round(pnl * 100) / 100 }))
      .sort((a, b) => b.pnl - a.pnl);
  }, []);

  const typeBreakdown = useMemo(() => {
    const map = {};
    TRADES.filter(isClosed).forEach(t => { map[t.type] = (map[t.type] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({
      name: name === 'Short Put' ? 'Short Puts' : name === 'Covered Call' ? 'Covered Calls' : name,
      value
    }));
  }, []);

  const winLossData = useMemo(() => [
    { name: 'Won', value: stats.wins, fill: '#34d399' },
    { name: 'Lost', value: stats.losses, fill: '#fb7185' },
  ], [stats]);

  const cumulativePnL = useMemo(() => {
    const closed = TRADES.filter(isClosed)
      .filter(t => t.closedOn)
      .map(t => ({ ...t, dateObj: parseDate(t.closedOn) }))
      .filter(t => t.dateObj)
      .sort((a, b) => a.dateObj - b.dateObj);
    let running = 0;
    return closed.map(t => {
      running += t.gainLoss;
      return {
        date: t.closedOn,
        pnl: Math.round(running * 100) / 100,
        ticker: t.ticker,
      };
    });
  }, []);

  // Open positions count + notional risk over time, reconstructed from acquired/closed dates
  const inPlayOverTime = useMemo(() => {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const fmtD = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear() - 2000}`;
    const events = [];
    TRADES.forEach(t => {
      // Notional only applies to short puts: riskLevel (in-play) or capital (closed)
      const notional = t.type === 'Short Put' ? (t.riskLevel || t.capital || 0) : 0;
      const open = parseDate(t.acquired);
      if (open) events.push({ d: open, delta: 1, notional });
      if (t.status !== 'IN PLAY') {
        const close = parseDate(t.closedOn || t.expires);
        if (close) events.push({ d: close, delta: -1, notional: -notional });
      }
    });
    events.sort((a, b) => a.d - b.d);
    const series = [];
    let count = 0;
    let notional = 0;
    events.forEach(e => {
      count += e.delta;
      notional += e.notional;
      const label = fmtD(e.d);
      if (series.length && series[series.length - 1].date === label) {
        series[series.length - 1].count = count;
        series[series.length - 1].notional = notional;
      } else {
        series.push({ date: label, count, notional });
      }
    });
    return series;
  }, []);

  const riskByCategory = useMemo(() => {
    const map = {};
    TRADES.filter(t => t.status === 'IN PLAY' && t.riskCategory).forEach(t => {
      if (!map[t.riskCategory]) map[t.riskCategory] = { count: 0, notional: 0 };
      map[t.riskCategory].count += 1;
      map[t.riskCategory].notional += (t.riskLevel || 0);
    });
    const meta = {
      'Very Safe': { color: '#15803d', range: '>20%' },
      'Safe':      { color: '#86efac', range: '10-20%' },
      'Alert':     { color: '#eab308', range: '5-10%' },
      'Danger':    { color: '#f97316', range: '0-5%' },
      'ITM':       { color: '#dc2626', range: '-5-0%' },
      'Deep ITM':  { color: '#7f1d1d', range: '<-5%' },
    };
    const order = ['Very Safe', 'Safe', 'Alert', 'Danger', 'ITM', 'Deep ITM'];
    return order.map(name => ({
      name,
      value: map[name]?.count || 0,
      notional: map[name]?.notional || 0,
      fill: meta[name].color,
      range: meta[name].range,
    }));
  }, []);

  // Open positions grouped by ticker — count of contracts in play
  const openPositionsByTicker = useMemo(() => {
    const map = {};
    TRADES.filter(t => t.status === 'IN PLAY').forEach(t => {
      if (!map[t.ticker]) map[t.ticker] = { puts: 0, calls: 0 };
      if (t.type === 'Short Put') map[t.ticker].puts += t.contracts;
      else if (t.type === 'Covered Call') map[t.ticker].calls += t.contracts;
    });
    return Object.entries(map)
      .map(([ticker, v]) => ({ ticker, puts: v.puts, calls: v.calls, total: v.puts + v.calls }))
      .sort((a, b) => b.total - a.total);
  }, []);

  // Notional risk grouped by ticker — only short puts have notional risk
  const notionalByTicker = useMemo(() => {
    const map = {};
    TRADES.filter(t => t.status === 'IN PLAY' && t.type === 'Short Put').forEach(t => {
      if (!map[t.ticker]) map[t.ticker] = { notional: 0, contracts: 0 };
      map[t.ticker].notional += (t.riskLevel || 0);
      map[t.ticker].contracts += t.contracts;
    });
    return Object.entries(map)
      .map(([ticker, v]) => ({ ticker, notional: v.notional, contracts: v.contracts }))
      .sort((a, b) => b.notional - a.notional);
  }, []);

  // Open positions grouped by expiration date — sorted closest to furthest
  const openPositionsByExpiration = useMemo(() => {
    const map = {};
    TRADES.filter(t => t.status === 'IN PLAY').forEach(t => {
      if (!map[t.expires]) map[t.expires] = { puts: 0, calls: 0, capitalAtRisk: 0 };
      if (t.type === 'Short Put') map[t.expires].puts += t.contracts;
      else if (t.type === 'Covered Call') map[t.expires].calls += t.contracts;
      map[t.expires].capitalAtRisk += (t.riskLevel || 0);
    });
    return Object.entries(map)
      .map(([expires, v]) => ({
        expires,
        puts: v.puts,
        calls: v.calls,
        total: v.puts + v.calls,
        capitalAtRisk: v.capitalAtRisk,
        dateObj: parseDate(expires),
      }))
      .filter(d => d.dateObj)
      .sort((a, b) => a.dateObj - b.dateObj);
  }, []);

  // Notional risk by expiration — SHORT PUTS ONLY (covered calls carry no put-side notional,
  // so a CC-only expiry date would otherwise render an empty $0 bucket).
  const notionalRiskByExpiration = useMemo(() => {
    const map = {};
    TRADES.filter(t => t.status === 'IN PLAY' && t.type === 'Short Put').forEach(t => {
      if (!map[t.expires]) map[t.expires] = { puts: 0, capitalAtRisk: 0 };
      map[t.expires].puts += t.contracts;
      map[t.expires].capitalAtRisk += (t.riskLevel || 0);
    });
    return Object.entries(map)
      .map(([expires, v]) => ({ expires, puts: v.puts, capitalAtRisk: v.capitalAtRisk, dateObj: parseDate(expires) }))
      .filter(d => d.dateObj && d.capitalAtRisk > 0)
      .sort((a, b) => a.dateObj - b.dateObj);
  }, []);

  // Risk Scenarios — simulate drawdowns on short put positions
  // For each scenario: new_price = current_price * (1 - drawdown%). If new_price < strike,
  // position is ITM and would be assigned at strike with paper loss = (strike - new_price) * 100 * contracts.
  // Net P&L for the scenario = sum across all short puts of (premium kept - assignment loss).
  const scenarios = useMemo(() => {
    const shortPuts = TRADES.filter(t => t.status === 'IN PLAY' && t.type === 'Short Put' && t.price);
    const drawdowns = [10, 15, 20, 25];
    return drawdowns.map(dd => {
      let netPnL = 0;
      let assignedCount = 0;
      let totalAssignedCapital = 0;
      let totalLoss = 0;
      let premiumKept = 0;
      const assignedPositions = [];
      shortPuts.forEach(t => {
        const newPrice = t.price * (1 - dd / 100);
        premiumKept += t.premium;
        if (newPrice >= t.strike) {
          netPnL += t.premium;
        } else {
          const lossPerShare = t.strike - newPrice;
          const positionLoss = lossPerShare * 100 * t.contracts;
          netPnL += t.premium - positionLoss;
          totalLoss += positionLoss;
          assignedCount++;
          totalAssignedCapital += t.strike * 100 * t.contracts;
          assignedPositions.push({ ...t, newPrice, positionLoss });
        }
      });
      return {
        drawdown: dd,
        netPnL,
        assignedCount,
        totalCount: shortPuts.length,
        totalAssignedCapital,
        totalLoss,
        premiumKept,
        assignedPositions: assignedPositions.sort((a, b) => b.positionLoss - a.positionLoss),
      };
    });
  }, []);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Status badge color
  const statusColor = (s) => {
    if (s === 'IN PLAY') return 'bg-sky-900/40 text-sky-300 border-sky-700/50';
    if (s === 'CLOSED') return 'bg-zinc-800/60 text-zinc-300 border-zinc-700/50';
    if (s === 'EXPIRED') return 'bg-zinc-800/60 text-zinc-300 border-zinc-700/50';
    if (s === 'ASSIGNED') return 'bg-zinc-800/60 text-zinc-300 border-zinc-700/50';
    return 'bg-zinc-800 text-zinc-400 border-zinc-700';
  };

  const riskColor = (r) => {
    if (r === 'Very Safe') return 'text-green-700';
    if (r === 'Safe') return 'text-green-300';
    if (r === 'Alert') return 'text-yellow-400';
    if (r === 'Danger') return 'text-orange-500';
    if (r === 'ITM' || r === 'Deep ITM') return 'text-red-600';
    return 'text-zinc-400';
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-3 sm:p-6" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        .font-serif { font-family: 'Fraunces', serif; }
        .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
      `}</style>

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6 sm:mb-8 pb-5 sm:pb-6 border-b border-zinc-800">
          <div>
            <div className="text-[10px] sm:text-xs font-mono uppercase tracking-[0.25em] text-amber-500/80 mb-2">Options Ledger</div>
            <h1 className="font-serif text-3xl sm:text-5xl font-bold tracking-tight">Portfolio<span className="text-amber-500">.</span></h1>
            <div className="text-xs sm:text-sm text-zinc-500 mt-2 font-mono">Short Puts & Covered Calls — Updated July 21, 2026</div>
          </div>
          <div className="grid grid-cols-2 sm:flex gap-x-6 gap-y-4 sm:gap-10">
            <div>
              <div className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">In Play</div>
              <div className="font-serif text-3xl sm:text-4xl font-bold num text-sky-400">
                {fmtCurrency(stats.premiumInPlay)}
              </div>
              <div className="text-xs font-mono text-zinc-500 mt-1">
                {stats.inPlayShortPuts} short put{stats.inPlayShortPuts !== 1 ? 's' : ''} · {stats.inPlayCoveredCalls} covered call{stats.inPlayCoveredCalls !== 1 ? 's' : ''}
              </div>
            </div>
            <div>
              <div className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Expiring 2026</div>
              <div className="font-serif text-3xl sm:text-4xl font-bold num text-amber-400">
                {fmtCurrency(stats.premiumInPlay2026)}
              </div>
              <div className="text-xs font-mono text-zinc-500 mt-1">
                {stats.inPlay2026} in play · {stats.inPlayBeyond2026} LEAPS to 2028
              </div>
            </div>
            <div className="sm:text-right">
              <div className="text-[10px] sm:text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Net Realized P&L</div>
              <div className={`font-serif text-3xl sm:text-4xl font-bold num ${stats.totalGain >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {stats.totalGain >= 0 ? '+' : ''}{fmtCurrency(stats.totalGain)}
              </div>
              <div className="text-xs font-mono text-zinc-500 mt-1">{stats.closed > 0 ? ((stats.wins / stats.closed) * 100).toFixed(1) : '0.0'}% win rate · {stats.closed} closed</div>
            </div>
          </div>
        </div>

        {/* View tabs */}
        <div className="flex gap-1 mb-6 bg-zinc-900/50 p-1 rounded-lg w-full sm:w-fit border border-zinc-800 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'pnl', label: 'P&L Analytics', icon: TrendingUp },
            { id: 'inplay', label: 'In Play Analytics', icon: Target },
            { id: 'scenarios', label: 'Risk Scenarios', icon: AlertTriangle },
            { id: 'goal', label: '$1M Goal', icon: Trophy },
            { id: 'puts', label: 'Short Puts', icon: TrendingDown },
            { id: 'calls', label: 'Covered Calls', icon: DollarSign },
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              className={`px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 ${
                activeView === v.id ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <v.icon size={14} />
              {v.label}
            </button>
          ))}
        </div>

        {/* OVERVIEW */}
        {activeView === 'overview' && (
          <div className="space-y-6">
            {/* Row 1: Headline counts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard label="Total Trades" value={stats.totalTrades} sublabel={`${stats.closed} closed · ${stats.wins} won · ${stats.losses} lost`} accent="amber" icon={Activity} />
              <StatCard label="Win Rate" value={`${stats.closed > 0 ? ((stats.wins / stats.closed) * 100).toFixed(1) : '0.0'}%`} sublabel={`${stats.wins} wins of ${stats.closed} trades`} accent="emerald" icon={TrendingUp} />
            </div>

            {/* Row 2: Realized P&L */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard label="Realized Gains" value={fmtCurrency(TRADES.filter(isClosed).filter(isWin).reduce((s,t)=>s+t.gainLoss,0))} sublabel={`Avg win ${fmtCurrency(stats.avgWin)}`} accent="emerald" icon={TrendingUp} large />
              <StatCard label="Realized Losses" value={fmtCurrency(TRADES.filter(isClosed).filter(isLoss).reduce((s,t)=>s+t.gainLoss,0))} sublabel={`Avg loss ${fmtCurrency(stats.avgLoss)}`} accent="rose" icon={TrendingDown} large />
            </div>

            {/* Row 3: Open exposure */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard label="In Play" value={stats.inPlay} sublabel={`${fmtCurrency(stats.premiumInPlay)} premium · ${stats.inPlayShortPuts} short put${stats.inPlayShortPuts !== 1 ? 's' : ''} · ${stats.inPlayCoveredCalls} covered call${stats.inPlayCoveredCalls !== 1 ? 's' : ''}`} accent="sky" icon={Target} />
              <StatCard label="Notional Risk" value={fmtCurrencyWhole(stats.riskInPlay)} sublabel="Max notional on open short puts" accent="rose" icon={AlertTriangle} />
            </div>

            {/* Cumulative P&L sneak peek */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">Cumulative Realized P&L</div>
                  <div className="font-serif text-2xl font-semibold mt-1">Equity Curve</div>
                </div>
                <div className={`text-2xl font-mono font-semibold num ${stats.totalGain >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {fmtCurrency(stats.totalGain)}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={cumulativePnL}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" />
                  <XAxis dataKey="date" stroke="#71717a" fontSize={10} />
                  <YAxis stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v) => [fmtCurrency(v), 'P&L']}
                  />
                  <Area type="monotone" dataKey="pnl" stroke="#f59e0b" strokeWidth={2} fill="url(#pnlGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* In play positions over time */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">Open Positions & Notional Risk Over Time</div>
                  <div className="font-serif text-2xl font-semibold mt-1">In Play</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-mono font-semibold num text-sky-400">{stats.inPlay}</div>
                  <div className="text-xs font-mono num text-rose-400">{fmtCurrencyWhole(stats.riskInPlay)}</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={inPlayOverTime}>
                  <defs>
                    <linearGradient id="inPlayGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" />
                  <XAxis dataKey="date" stroke="#71717a" fontSize={10} />
                  <YAxis yAxisId="count" stroke="#38bdf8" fontSize={10} allowDecimals={false} />
                  <YAxis yAxisId="notional" orientation="right" stroke="#fb7185" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    content={({ active, payload, label }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={TOOLTIP_STYLE.contentStyle}>
                          <div style={TOOLTIP_STYLE.labelStyle}>{label}</div>
                          <div style={{ ...TOOLTIP_STYLE.itemStyle, color: '#38bdf8' }}>Open Positions: {d.count}</div>
                          <div style={{ ...TOOLTIP_STYLE.itemStyle, color: '#fb7185' }}>Notional Risk: {fmtCurrencyWhole(d.notional)}</div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                    formatter={(value) => value === 'count' ? 'Open Positions' : 'Notional Risk'}
                  />
                  <Area yAxisId="count" type="stepAfter" dataKey="count" stroke="#38bdf8" strokeWidth={2} fill="url(#inPlayGrad)" />
                  <Line yAxisId="notional" type="stepAfter" dataKey="notional" stroke="#fb7185" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Top tickers */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Top Winners</div>
                <div className="font-serif text-xl font-semibold mb-4">By Ticker</div>
                <div className="space-y-2">
                  {tickerPnL.filter(t => t.pnl > 0).slice(0, 5).map(t => (
                    <div key={t.ticker} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                      <span className="font-mono font-semibold">{t.ticker}</span>
                      <span className="font-mono num text-emerald-400">+{fmtCurrency(t.pnl)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Top Losers</div>
                <div className="font-serif text-xl font-semibold mb-4">By Ticker</div>
                <div className="space-y-2">
                  {tickerPnL.filter(t => t.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 5).map(t => (
                    <div key={t.ticker} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                      <span className="font-mono font-semibold">{t.ticker}</span>
                      <span className="font-mono num text-rose-400">{fmtCurrency(t.pnl)}</span>
                    </div>
                  ))}
                  {tickerPnL.filter(t => t.pnl < 0).length === 0 && (
                    <div className="text-zinc-500 text-sm py-2">No losing tickers</div>
                  )}
                </div>
              </div>
            </div>

            {/* Top trades */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Top Winners</div>
                <div className="font-serif text-xl font-semibold mb-4">By Trade</div>
                <div className="space-y-2">
                  {TRADES.filter(isClosed).filter(t => t.gainLoss > 0).sort((a, b) => b.gainLoss - a.gainLoss).slice(0, 5).map((t, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0 gap-3">
                      <span className="font-mono text-sm whitespace-nowrap">
                        <span className="font-semibold">{t.ticker}</span>
                        <span className="text-zinc-500 font-normal"> {t.strike} {t.type === 'Short Put' ? 'Put' : 'Call'} {t.contracts}×</span>
                      </span>
                      <span className="font-mono num text-emerald-400 whitespace-nowrap">+{fmtCurrency(t.gainLoss)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Top Losers</div>
                <div className="font-serif text-xl font-semibold mb-4">By Trade</div>
                <div className="space-y-2">
                  {TRADES.filter(isClosed).filter(t => t.gainLoss < 0).sort((a, b) => a.gainLoss - b.gainLoss).slice(0, 5).map((t, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0 gap-3">
                      <span className="font-mono text-sm whitespace-nowrap">
                        <span className="font-semibold">{t.ticker}</span>
                        <span className="text-zinc-500 font-normal"> {t.strike} {t.type === 'Short Put' ? 'Put' : 'Call'} {t.contracts}×</span>
                      </span>
                      <span className="font-mono num text-rose-400 whitespace-nowrap">{fmtCurrency(t.gainLoss)}</span>
                    </div>
                  ))}
                  {TRADES.filter(isClosed).filter(t => t.gainLoss < 0).length === 0 && (
                    <div className="text-zinc-500 text-sm py-2">No losing trades</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SHORT PUTS LEDGER */}
        {activeView === 'puts' && (
          <TradeLedger
            trades={putsTrades}
            totalCount={TRADES.filter(t => t.type === 'Short Put').length}
            strategy="Short Puts"
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            outcomeFilter={outcomeFilter}
            setOutcomeFilter={setOutcomeFilter}
            bufferLevels={bufferLevels}
            setBufferLevels={setBufferLevels}
            search={search}
            setSearch={setSearch}
            sortKey={sortKey}
            sortDir={sortDir}
            handleSort={handleSort}
            statusColor={statusColor}
            riskColor={riskColor}
          />
        )}

        {/* COVERED CALLS LEDGER */}
        {activeView === 'calls' && (
          <CallsLedger
            trades={callsTrades}
            totalCount={TRADES.filter(t => t.type === 'Covered Call').length}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            outcomeFilter={outcomeFilter}
            setOutcomeFilter={setOutcomeFilter}
            bufferLevels={bufferLevels}
            setBufferLevels={setBufferLevels}
            search={search}
            setSearch={setSearch}
            sortKey={sortKey}
            sortDir={sortDir}
            handleSort={handleSort}
            statusColor={statusColor}
            riskColor={riskColor}
          />
        )}

        {/* P&L ANALYTICS */}
        {activeView === 'pnl' && (
          <div className="space-y-6">
            {/* ==================== OVERVIEW ==================== */}
            <div>
              <div className="flex items-baseline gap-3 mb-3 border-b border-zinc-800 pb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2 py-0.5 border border-amber-500/40 rounded">Section</span>
                <h2 className="font-serif text-xl sm:text-2xl font-semibold">Overview</h2>
                <span className="text-xs font-mono text-zinc-500">— portfolio-wide P&L across both strategies</span>
              </div>
            </div>

            {/* Monthly realized P&L (bars only) */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Realized P&L</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-1">By Month</div>
              <div className="text-xs font-mono text-zinc-500 mb-4">Forecast = expected capture of current open book by expiry month (shaded range: stressed → full capture)</div>
              {(() => {
                const maxVal = Math.max(
                  0,
                  ...monthlyPnL.map(d => Math.max(d.pnl || 0, d.forecastPnl || 0, d.fHigh || 0))
                );
                const minVal = Math.min(0, ...monthlyPnL.map(d => d.pnl || 0));
                const top = Math.ceil(maxVal / 5000) * 5000;
                const bottom = Math.floor(minVal / 5000) * 5000;
                const yTicks = [];
                for (let v = bottom; v <= top; v += 5000) yTicks.push(v);
                return (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={monthlyPnL} margin={{ top: 25, right: 10, left: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" />
                  <XAxis dataKey="month" stroke="#71717a" fontSize={11} />
                  <YAxis stroke="#34d399" fontSize={10} domain={[bottom, top]} ticks={yTicks} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={TOOLTIP_STYLE.contentStyle}>
                          <div style={TOOLTIP_STYLE.labelStyle}>{label}{d.count ? ` · ${d.count} closed` : ' · forecast'}</div>
                          {d.pnl !== undefined && (
                            <div style={{ ...TOOLTIP_STYLE.itemStyle, color: d.pnl >= 0 ? '#34d399' : '#fb7185' }}>
                              {d.forecastPnl !== undefined ? 'Realized so far' : 'Month P&L'}: {d.pnl >= 0 ? '+' : ''}{fmtCurrency(d.pnl)}
                            </div>
                          )}
                          {d.forecastPnl !== undefined && (
                            <div style={{ ...TOOLTIP_STYLE.itemStyle, color: '#fbbf24' }}>
                              {d.pnl !== undefined ? 'Projected end' : 'Forecast'}: +{fmtCurrency(d.forecastPnl)} <span style={{ color: '#71717a' }}>({fmtCurrencyWhole(d.fLow)} – {fmtCurrencyWhole(d.fHigh)})</span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                    formatter={(value) => value === 'pnl' ? 'Monthly P&L' : 'Forecast (central ± range)'}
                  />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {monthlyPnL.map((entry, i) => (
                      <Cell key={i} fill={entry.pnl === undefined ? 'transparent' : entry.pnl >= 0 ? '#34d399' : '#fb7185'} />
                    ))}
                    <LabelList
                      dataKey="pnl"
                      position="top"
                      formatter={(v) => v !== undefined ? `$${(v/1000).toFixed(1)}k` : ''}
                      style={{ fill: '#e4e4e7', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}
                    />
                  </Bar>
                  <Line type="monotone" dataKey="forecastPnl" stroke="none" legendType="plainline" name="forecast" dot={{ r: 4, fill: '#f59e0b', stroke: '#18181b', strokeWidth: 1 }} isAnimationActive={false}>
                    <ErrorBar dataKey="forecastErr" width={6} strokeWidth={1.5} stroke="#f59e0b" direction="y" />
                    <LabelList
                      dataKey="forecastPnl"
                      position="top"
                      offset={12}
                      formatter={(v) => v !== undefined ? `$${(v/1000).toFixed(1)}k` : ''}
                      style={{ fill: '#a1a1aa', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}
                    />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
                );
              })()}
              <div className="mt-4 pt-3 border-t border-zinc-800/60 text-[10px] font-mono text-zinc-500 leading-relaxed">
                <span className="text-zinc-400">Forecast assumptions:</span> central line = probability-of-OTM weighted premium capture by buffer tier, adjusted for how positions are actually managed:
                <span className="text-zinc-400"> (1)</span> capture rate haircut to <span className="text-zinc-300">85%</span> of max premium — positions are typically closed before the last dollar, though many safe ones are let expire;
                <span className="text-zinc-400"> (2)</span> timing shift — <span className="text-zinc-300">half</span> of each position's expected capture is booked <span className="text-zinc-300">~4 weeks early</span> (prior month), reflecting closing sooner and peeling off higher-strike legs to de-risk.
                Shaded band spans stressed → full capture. Covered calls assume full premium retention at 85% capture.
              </div>
            </div>

            {/* Cumulative equity curve */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Realized P&L</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-1">Equity Curve</div>
              <div className="text-xs font-mono text-zinc-500 mb-4">Dashed = central forecast of current open book (shaded band: stressed → full capture)</div>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={monthlyPnL} margin={{ top: 25, right: 10, left: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" />
                  <XAxis dataKey="month" stroke="#71717a" fontSize={11} />
                  <YAxis stroke="#f59e0b" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={TOOLTIP_STYLE.contentStyle}>
                          <div style={TOOLTIP_STYLE.labelStyle}>{label}</div>
                          {d.cumulative !== undefined && (
                            <div style={{ ...TOOLTIP_STYLE.itemStyle, color: '#f59e0b' }}>Cumulative: {fmtCurrency(d.cumulative)}</div>
                          )}
                          {d.cumCentral !== undefined && d.cumRange && d.cumRange[0] !== d.cumRange[1] && (
                            <div style={{ ...TOOLTIP_STYLE.itemStyle, color: '#fbbf24' }}>
                              Cum. forecast: {fmtCurrencyWhole(d.cumCentral)} <span style={{ color: '#71717a' }}>({fmtCurrencyWhole(d.cumRange[0])} – {fmtCurrencyWhole(d.cumRange[1])})</span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                    formatter={(value) => (
                      value === 'cumulative' ? 'Cumulative P&L'
                      : value === 'cumCentral' ? 'Cumulative Forecast'
                      : 'Forecast Range'
                    )}
                  />
                  <Area dataKey="cumRange" stroke="none" fill="#f59e0b" fillOpacity={0.12} />
                  <Line type="monotone" dataKey="cumulative" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3, fill: '#f59e0b' }} />
                  <Line type="monotone" dataKey="cumCentral" stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3, fill: '#18181b', stroke: '#f59e0b' }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* P&L by ticker */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Realized P&L</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">By Ticker</div>
              <ResponsiveContainer width="100%" height={Math.max(300, tickerPnL.length * 28)}>
                <BarChart data={tickerPnL} layout="vertical" margin={{ left: 10, right: 75, top: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" horizontal={false} />
                  <XAxis type="number" stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(1)}k`} />
                  <YAxis dataKey="ticker" type="category" stroke="#71717a" fontSize={10} width={42} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v) => [fmtCurrency(v), 'P&L']}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                    {tickerPnL.map((entry, i) => (
                      <Cell key={i} fill={entry.pnl >= 0 ? '#34d399' : '#fb7185'} />
                    ))}
                    <LabelList
                      dataKey="pnl"
                      position="right"
                      formatter={(v) => fmtCurrency(v)}
                      style={{ fill: '#fafafa', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Realized P&L by strategy */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Realized P&L</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Short Puts vs Covered Calls</div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={strategyPnL} margin={{ top: 25, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" />
                  <XAxis dataKey="name" stroke="#71717a" fontSize={11} />
                  <YAxis stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={TOOLTIP_STYLE.contentStyle}>
                          <div style={TOOLTIP_STYLE.labelStyle}>{d.name} · {d.count} closed</div>
                          <div style={{ ...TOOLTIP_STYLE.itemStyle, color: '#34d399' }}>Gains: +{fmtCurrency(d.gains)}</div>
                          <div style={{ ...TOOLTIP_STYLE.itemStyle, color: '#fb7185' }}>Losses: {fmtCurrency(d.losses)}</div>
                          <div style={{ ...TOOLTIP_STYLE.itemStyle, color: '#f59e0b' }}>Net: {d.net >= 0 ? '+' : ''}{fmtCurrency(d.net)}</div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
                    formatter={(value) => value === 'gains' ? 'Gains' : value === 'losses' ? 'Losses' : 'Net'}
                  />
                  <Bar dataKey="gains" fill="#34d399" radius={[4, 4, 0, 0]}>
                    <LabelList
                      dataKey="gains"
                      position="top"
                      formatter={(v) => `+$${(v/1000).toFixed(1)}k`}
                      style={{ fill: '#34d399', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}
                    />
                  </Bar>
                  <Bar dataKey="losses" fill="#fb7185" radius={[0, 0, 4, 4]}>
                    <LabelList
                      dataKey="losses"
                      position="bottom"
                      formatter={(v) => `-$${(Math.abs(v)/1000).toFixed(1)}k`}
                      style={{ fill: '#fb7185', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}
                    />
                  </Bar>
                  <Bar dataKey="net" fill="#f59e0b" radius={[4, 4, 0, 0]}>
                    <LabelList
                      dataKey="net"
                      position="top"
                      formatter={(v) => `$${(v/1000).toFixed(1)}k`}
                      style={{ fill: '#f59e0b', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Win/Loss */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Outcomes</div>
                <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Won / Lost</div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={winLossData}
                      cx="50%" cy="50%"
                      innerRadius={60} outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                    >
                      {winLossData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Type breakdown */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Strategy Mix · Closed Trades</div>
                <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Put / Call Split</div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={typeBreakdown}
                      cx="50%" cy="50%"
                      innerRadius={60} outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                    >
                      <Cell fill="#f59e0b" />
                      <Cell fill="#38bdf8" />
                    </Pie>
                    <Tooltip {...TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Losing trades */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Realized Losses</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">
                Losing Trades <span className="text-zinc-500 text-base font-mono font-normal">({losingTrades.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                      <th className="px-3 py-3 text-left">Ticker</th>
                      <th className="px-3 py-3 text-left">Type</th>
                      <th className="px-3 py-3 text-right">Strike</th>
                      <th className="px-3 py-3 text-left">Status</th>
                      <th className="px-3 py-3 text-left">Closed</th>
                      <th className="px-3 py-3 text-right">Capital Deployed</th>
                      <th className="px-3 py-3 text-right">Loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {losingTrades.map((t, i) => (
                      <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-200">{t.ticker} {t.contracts}×</td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-400">{t.type}</td>
                        <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-300">${t.strike}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          <span className={t.status === 'ASSIGNED' ? 'text-amber-400' : 'text-zinc-400'}>{t.status}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-400">{t.closedOn}</td>
                        <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-400">{t.capital ? fmtCurrencyWhole(t.capital) : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono num text-xs font-semibold text-rose-400">{fmtCurrency(t.gainLoss)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-zinc-700">
                    <tr>
                      <td colSpan={5} className="px-3 py-2.5 text-right text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                        Total
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono num text-xs font-semibold text-zinc-200">
                        {fmtCurrencyWhole(losingTrades.reduce((s, t) => s + (t.capital || 0), 0))}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono num text-xs font-semibold text-rose-400">
                        {fmtCurrency(losingTrades.reduce((s, t) => s + t.gainLoss, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ==================== SHORT PUTS ==================== */}
            <div className="pt-4">
              <div className="flex items-baseline gap-3 mb-3 border-b border-zinc-800 pb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 px-2 py-0.5 border border-emerald-500/40 rounded">Section</span>
                <h2 className="font-serif text-xl sm:text-2xl font-semibold">Short Puts</h2>
                <span className="text-xs font-mono text-zinc-500">— assigned positions, outcome, win rate, by ticker</span>
              </div>
            </div>

            {/* Assigned short puts */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Assigned Short Puts</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">
                Assigned Positions <span className="text-zinc-500 text-base font-mono font-normal">({assignedPuts.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                      <th className="px-3 py-3 text-left">Ticker</th>
                      <th className="px-3 py-3 text-right"># of Shares</th>
                      <th className="px-3 py-3 text-right">Strike</th>
                      <th className="px-3 py-3 text-right">Capital Deployed</th>
                      <th className="px-3 py-3 text-right">Loss/Gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignedPuts.map((t, i) => (
                      <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-200">{t.ticker} {t.contracts}×</td>
                        <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-300">{t.shares.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-300">${t.strike}</td>
                        <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-400">{t.capital ? fmtCurrencyWhole(t.capital) : '—'}</td>
                        <td className={`px-3 py-2 text-right font-mono num text-xs font-semibold ${t.gainLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.gainLoss >= 0 ? '+' : ''}{fmtCurrency(t.gainLoss)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-zinc-700">
                    <tr>
                      <td className="px-3 py-2.5 text-right text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                        Total
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono num text-xs font-semibold text-zinc-200">
                        {assignedPuts.reduce((s, t) => s + t.shares, 0).toLocaleString()}
                      </td>
                      <td></td>
                      <td className="px-3 py-2.5 text-right font-mono num text-xs font-semibold text-zinc-200">
                        {fmtCurrencyWhole(assignedPuts.reduce((s, t) => s + (t.capital || 0), 0))}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono num text-xs font-semibold ${assignedPuts.reduce((s, t) => s + t.gainLoss, 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {(() => {
                          const tot = assignedPuts.reduce((s, t) => s + t.gainLoss, 0);
                          return (tot >= 0 ? '+' : '') + fmtCurrency(tot);
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Short put outcome donuts + by-ticker chart */}
            <div className="grid md:grid-cols-2 gap-6 items-start">
              {/* Left column: two donuts stacked */}
              <div className="grid grid-cols-1 gap-6">
                {/* Won vs Lost */}
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                  <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Short Puts · Win Rate</div>
                  <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Won vs Lost</div>
                  <ResponsiveContainer width="100%" height={380}>
                    <PieChart>
                      <Pie
                        data={putWinLossSplit}
                        cx="50%" cy="50%"
                        innerRadius={60} outerRadius={105}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {putWinLossSplit.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip {...TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Expired/Closed vs Assigned */}
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                  <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Short Puts · Outcome</div>
                  <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Expired / Closed vs Assigned</div>
                  <ResponsiveContainer width="100%" height={380}>
                    <PieChart>
                      <Pie
                        data={putOutcomeSplit}
                        cx="50%" cy="50%"
                        innerRadius={60} outerRadius={105}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                      >
                        {putOutcomeSplit.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip {...TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Right column: P&L by ticker (tall) */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Short Puts · By Ticker</div>
                <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Realized P&L</div>
                <ResponsiveContainer width="100%" height={Math.max(260, putPnLByTicker.length * 26)}>
                  <BarChart data={putPnLByTicker} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="2 2" horizontal={false} />
                    <XAxis type="number" stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(1)}k`} />
                    <YAxis type="category" dataKey="ticker" stroke="#71717a" fontSize={10} width={50} />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      formatter={(v) => [`${v >= 0 ? '+' : ''}${fmtCurrency(v)}`, 'Net P&L']}
                    />
                    <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
                      {putPnLByTicker.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? '#34d399' : '#fb7185'} />
                      ))}
                      <LabelList
                        dataKey="pnl"
                        position="right"
                        formatter={(v) => `${v >= 0 ? '+' : ''}$${(v/1000).toFixed(1)}k`}
                        style={{ fill: '#a1a1aa', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Short puts — per-trade computed yield */}
            {(() => {
              const sorted = [...putYields].sort((a, b) => {
                let av = a[yieldSortKey], bv = b[yieldSortKey];
                if (yieldSortKey === 'ticker') {
                  return yieldSortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
                }
                if (yieldSortKey === 'closedOn' || yieldSortKey === 'acquired') {
                  av = parseDate(av)?.getTime() ?? 0; bv = parseDate(bv)?.getTime() ?? 0;
                }
                if (av === undefined || av === null) av = -Infinity;
                if (bv === undefined || bv === null) bv = -Infinity;
                return yieldSortDir === 'asc' ? av - bv : bv - av;
              });
              const handleYieldSort = (k) => {
                if (yieldSortKey === k) { setYieldSortDir(yieldSortDir === 'asc' ? 'desc' : 'asc'); }
                else { setYieldSortKey(k); setYieldSortDir(k === 'ticker' ? 'asc' : 'desc'); }
              };
              const YTh = ({ label, k, right }) => (
                <th className={`px-3 py-3 ${right ? 'text-right' : 'text-left'} cursor-pointer select-none hover:text-zinc-300 ${yieldSortKey === k ? 'text-amber-500' : ''}`} onClick={() => handleYieldSort(k)}>
                  <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>{label}{yieldSortKey === k && <span className="text-[8px]">{yieldSortDir === 'asc' ? '▲' : '▼'}</span>}</span>
                </th>
              );
              const avgAnn = putYields.filter(y => y.annYield !== null).reduce((s, y, _, arr) => s + y.annYield / arr.length, 0);
              const totGain = putYields.reduce((s, y) => s + y.gainLoss, 0);
              return (
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                  <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Short Puts · Yield</div>
                  <div className="font-serif text-xl sm:text-2xl font-semibold mb-1">
                    Per-Trade Realized Yield <span className="text-zinc-500 text-base font-mono font-normal">({putYields.length})</span>
                  </div>
                  <div className="text-xs font-mono text-zinc-500 mb-4">Annualized = (gain ÷ capital) × (365 ÷ days held). Computed from trade dates — click any column to sort.</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                          <YTh label="Ticker" k="ticker" />
                          <YTh label="Strike" k="strike" right />
                          <YTh label="Acquired" k="acquired" />
                          <YTh label="Closed" k="closedOn" />
                          <YTh label="Days" k="days" right />
                          <YTh label="Gain" k="gainLoss" right />
                          <YTh label="Capital" k="capital" right />
                          <YTh label="Simple %" k="simpleYield" right />
                          <YTh label="Annualized %" k="annYield" right />
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((y, i) => (
                          <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                            <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-200">{y.ticker} {y.contracts}×</td>
                            <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-300">${y.strike}</td>
                            <td className="px-3 py-2 font-mono text-xs text-zinc-400">{y.acquired}</td>
                            <td className="px-3 py-2 font-mono text-xs text-zinc-400">{y.closedOn}</td>
                            <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-400">{y.days ?? '—'}</td>
                            <td className={`px-3 py-2 text-right font-mono num text-xs font-semibold ${y.gainLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{y.gainLoss >= 0 ? '+' : ''}{fmtCurrency(y.gainLoss)}</td>
                            <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-400">{fmtCurrencyWhole(y.capital)}</td>
                            <td className={`px-3 py-2 text-right font-mono num text-xs ${y.simpleYield >= 0 ? 'text-zinc-300' : 'text-rose-400'}`}>{y.simpleYield !== null ? `${y.simpleYield >= 0 ? '+' : ''}${y.simpleYield.toFixed(2)}%` : '—'}</td>
                            <td className={`px-3 py-2 text-right font-mono num text-xs font-semibold ${y.annYield >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{y.annYield !== null ? `${y.annYield >= 0 ? '+' : ''}${y.annYield.toFixed(1)}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-zinc-700">
                        <tr>
                          <td colSpan={5} className="px-3 py-2.5 text-right text-[10px] font-mono uppercase tracking-wider text-zinc-500">Avg annualized {avgAnn.toFixed(1)}% · Total gain</td>
                          <td className="px-3 py-2.5 text-right font-mono num text-xs font-semibold text-emerald-400">+{fmtCurrency(totGain)}</td>
                          <td colSpan={3}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* ==================== COVERED CALLS ==================== */}
            <div className="pt-4">
              <div className="flex items-baseline gap-3 mb-3 border-b border-zinc-800 pb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400 px-2 py-0.5 border border-sky-500/40 rounded">Section</span>
                <h2 className="font-serif text-xl sm:text-2xl font-semibold">Covered Calls</h2>
                <span className="text-xs font-mono text-zinc-500">— closed positions, win rate, by ticker</span>
              </div>
            </div>

            {/* Closed covered calls */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Covered Calls · Closed</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-1">
                Closed Covered Calls <span className="text-zinc-500 text-base font-mono font-normal">({closedCalls.length})</span>
              </div>
              <div className="text-xs font-mono text-zinc-500 mb-4">All rolled or closed — no underlying shares sold.</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                      <th className="px-3 py-3 text-left">Ticker</th>
                      <th className="px-3 py-3 text-right"># of Shares</th>
                      <th className="px-3 py-3 text-right">Strike</th>
                      <th className="px-3 py-3 text-left">Acquired</th>
                      <th className="px-3 py-3 text-left">Closed</th>
                      <th className="px-3 py-3 text-right">Loss/Gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedCalls.map((t, i) => (
                      <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-zinc-200">{t.ticker} {t.contracts}×</td>
                        <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-300">{(t.contracts * 100).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-300">${t.strike}</td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-400">{t.acquired}</td>
                        <td className="px-3 py-2 font-mono text-xs text-zinc-400">{t.closedOn}</td>
                        <td className={`px-3 py-2 text-right font-mono num text-xs font-semibold ${t.gainLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.gainLoss >= 0 ? '+' : ''}{fmtCurrency(t.gainLoss)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-zinc-700">
                    <tr>
                      <td colSpan={5} className="px-3 py-2.5 text-right text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                        Total ({closedCalls.filter(t => t.gainLoss > 0).length}W / {closedCalls.filter(t => t.gainLoss < 0).length}L)
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono num text-xs font-semibold ${closedCalls.reduce((s, t) => s + t.gainLoss, 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {(() => {
                          const tot = closedCalls.reduce((s, t) => s + t.gainLoss, 0);
                          return (tot >= 0 ? '+' : '') + fmtCurrency(tot);
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Covered call outcome donut */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Won vs Lost */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Covered Calls · Win Rate</div>
                <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Won vs Lost</div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={callWinLossSplit}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                    >
                      {callWinLossSplit.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip {...TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* P&L by ticker */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Covered Calls · By Ticker</div>
                <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Realized P&L</div>
                <ResponsiveContainer width="100%" height={Math.max(260, callPnLByTicker.length * 34)}>
                  <BarChart data={callPnLByTicker} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="2 2" horizontal={false} />
                    <XAxis type="number" stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(1)}k`} />
                    <YAxis type="category" dataKey="ticker" stroke="#71717a" fontSize={11} width={50} />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      formatter={(v) => [`${v >= 0 ? '+' : ''}${fmtCurrency(v)}`, 'Net P&L']}
                    />
                    <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
                      {callPnLByTicker.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? '#34d399' : '#fb7185'} />
                      ))}
                      <LabelList
                        dataKey="pnl"
                        position="right"
                        formatter={(v) => `${v >= 0 ? '+' : ''}$${(v/1000).toFixed(1)}k`}
                        style={{ fill: '#a1a1aa', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
        {/* IN PLAY ANALYTICS */}
        {activeView === 'inplay' && (
          <div className="space-y-6">
            {/* Risk by category in play */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Risk Distribution</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">Buffer Levels (In Play)</div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={riskByCategory} margin={{ top: 20, right: 20, left: 0, bottom: 18 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" />
                  <XAxis
                    dataKey="name"
                    stroke="#71717a"
                    fontSize={11}
                    interval={0}
                    tick={({ x, y, payload }) => {
                      const item = riskByCategory.find(d => d.name === payload.value);
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text x={0} y={0} dy={14} textAnchor="middle" fill="#a1a1aa" fontSize={11} fontFamily="IBM Plex Mono, monospace">{payload.value}</text>
                          <text x={0} y={0} dy={28} textAnchor="middle" fill="#52525b" fontSize={10} fontFamily="IBM Plex Mono, monospace">({item?.range})</text>
                        </g>
                      );
                    }}
                  />
                  <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={TOOLTIP_STYLE.contentStyle}>
                          <div style={TOOLTIP_STYLE.labelStyle}>{d.name} ({d.range})</div>
                          <div style={TOOLTIP_STYLE.itemStyle}>Positions: {d.value}</div>
                          <div style={TOOLTIP_STYLE.itemStyle}>Notional Risk: {fmtCurrencyWhole(d.notional)}</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {riskByCategory.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    <LabelList
                      dataKey="value"
                      position="top"
                      style={{ fill: '#e4e4e7', fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* At-risk positions */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="p-4 sm:p-6 pb-3">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">At Risk Positions</div>
                <div className="font-serif text-xl sm:text-2xl font-semibold">Alert · Danger · ITM · Deep ITM</div>
              </div>
              {(() => {
                const atRisk = TRADES
                  .filter(t => t.status === 'IN PLAY' && ['Alert', 'Danger', 'ITM', 'Deep ITM'].includes(t.riskCategory))
                  .sort((a, b) => (a.buffer || 0) - (b.buffer || 0));
                if (atRisk.length === 0) {
                  return (
                    <div className="px-4 sm:px-6 pb-5 text-sm font-mono text-emerald-500/80">
                      ✓ No positions in Alert, Danger, ITM, or Deep ITM. All open positions have a buffer above 10%.
                    </div>
                  );
                }
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-900 border-y border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="px-3 py-3 text-left">Ticker</th>
                          <th className="px-3 py-3 text-left">Type</th>
                          <th className="px-3 py-3 text-left">Expires</th>
                          <th className="px-3 py-3 text-right">Strike</th>
                          <th className="px-3 py-3 text-right">Price</th>
                          <th className="px-3 py-3 text-right">Break-Even</th>
                          <th className="px-3 py-3 text-right">Buffer %</th>
                          <th className="px-3 py-3 text-right">Buffer to BE %</th>
                          <th className="px-3 py-3 text-right">Buffer Level</th>
                          <th className="px-3 py-3 text-right">Notional</th>
                          <th className="px-3 py-3 text-right">Paper Loss</th>
                          <th className="px-3 py-3 text-right">Loss (incl. premium)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {atRisk.map((t, i) => {
                          // Break-even and buffer-to-BE only meaningful for short puts here
                          const premPerShare = t.premium / (100 * t.contracts);
                          const breakEven = t.type === 'Short Put'
                            ? t.strike - premPerShare
                            : t.type === 'Covered Call'
                              ? t.strike + premPerShare  // CCs: BE is above strike by premium
                              : null;
                          const bufferToBE = (breakEven && t.price)
                            ? t.type === 'Short Put'
                              ? ((t.price - breakEven) / t.price) * 100
                              : ((breakEven - t.price) / t.price) * 100
                            : null;
                          // Paper loss: intrinsic cost if assigned at current price (ITM short puts only)
                          const paperLoss = (t.type === 'Short Put' && t.price < t.strike)
                            ? (t.strike - t.price) * 100 * t.contracts
                            : 0;
                          // Net loss including premium collected: only shown when still net-negative (price below break-even)
                          const netLoss = (t.type === 'Short Put' && paperLoss > 0)
                            ? Math.max(paperLoss - t.premium, 0)
                            : 0;
                          return (
                            <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-900/60 transition-colors">
                              <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">
                                {t.ticker} <span className="text-zinc-500 font-normal">{t.contracts}×</span>
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-zinc-400">{t.type}</td>
                              <td className="px-3 py-2 font-mono text-xs text-zinc-400">{t.expires}</td>
                              <td className="px-3 py-2 text-right font-mono num">${t.strike}</td>
                              <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-300">${t.price?.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-200">
                                {breakEven !== null ? `$${breakEven.toFixed(2)}` : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono num text-xs">
                                <span className={riskColor(t.riskCategory)}>{fmtPct(t.buffer)}</span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono num text-xs">
                                <span className={bufferToBE !== null && bufferToBE >= 0 ? 'text-zinc-200' : 'text-rose-400'}>
                                  {bufferToBE !== null ? fmtPct(bufferToBE) : '—'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <span className={`font-mono text-xs ${riskColor(t.riskCategory)}`}>
                                  {bufferIcon(t.riskCategory)} {t.riskCategory}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono num text-xs text-zinc-400">
                                {t.riskLevel ? fmtCurrencyWhole(t.riskLevel) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono num text-xs">
                                <span className={paperLoss > 0 ? 'text-rose-400' : 'text-zinc-600'}>
                                  {paperLoss > 0 ? `-${fmtCurrencyWhole(paperLoss)}` : '$0'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono num text-xs">
                                <span className={netLoss > 0 ? 'text-rose-400' : 'text-zinc-600'}>
                                  {netLoss > 0 ? `-${fmtCurrencyWhole(netLoss)}` : '$0'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t border-zinc-700">
                        <tr>
                          <td colSpan={9} className="px-3 py-2.5 text-right text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                            Totals
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono num text-xs font-semibold text-zinc-200">
                            {fmtCurrencyWhole(atRisk.reduce((s, t) => s + (t.riskLevel || 0), 0))}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono num text-xs font-semibold text-rose-400">
                            {(() => {
                              const totalPaper = atRisk.reduce((s, t) =>
                                s + ((t.type === 'Short Put' && t.price < t.strike) ? (t.strike - t.price) * 100 * t.contracts : 0), 0);
                              return totalPaper > 0 ? `-${fmtCurrencyWhole(totalPaper)}` : '$0';
                            })()}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono num text-xs font-semibold text-rose-400">
                            {(() => {
                              const totalNet = atRisk.reduce((s, t) => {
                                const pl = (t.type === 'Short Put' && t.price < t.strike) ? (t.strike - t.price) * 100 * t.contracts : 0;
                                return s + (pl > 0 ? Math.max(pl - t.premium, 0) : 0);
                              }, 0);
                              return totalNet > 0 ? `-${fmtCurrencyWhole(totalNet)}` : '$0';
                            })()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    <div className="px-3 pt-3 pb-1 text-[10px] font-mono leading-relaxed text-zinc-500">
                      <span className="text-zinc-400">Paper Loss</span> = mark-to-market intrinsic if assigned at the current price, <span className="text-zinc-400">(strike − price) × 100 × contracts</span>; it ignores premium already collected.
                      <br />
                      <span className="text-zinc-400">Loss (incl. premium)</span> = paper loss net of premium received, i.e. the true economic loss only once price falls below break-even. $0 means the premium cushion still covers the position.
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Open positions by ticker */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Open Positions</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">By Ticker</div>
              <ResponsiveContainer width="100%" height={Math.max(300, openPositionsByTicker.length * 28)}>
                <BarChart data={openPositionsByTicker} layout="vertical" margin={{ left: 10, right: 60, top: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" horizontal={false} />
                  <XAxis type="number" stroke="#71717a" fontSize={10} allowDecimals={false} />
                  <YAxis dataKey="ticker" type="category" stroke="#71717a" fontSize={10} width={42} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(v, name) => [v + ' contracts', name === 'puts' ? 'Short Puts' : 'Covered Calls']}
                  />
                  <Legend
                    verticalAlign="top"
                    height={36}
                    iconType="circle"
                    formatter={(v) => v === 'puts' ? 'Short Puts' : 'Covered Calls'}
                    wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#a1a1aa' }}
                  />
                  <Bar dataKey="puts" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="calls" stackId="a" fill="#38bdf8" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="total"
                      position="right"
                      style={{ fill: '#fafafa', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Open positions by expiration date */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Open Positions</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">By Expiration</div>
              <ResponsiveContainer width="100%" height={Math.max(300, openPositionsByExpiration.length * 36)}>
                <BarChart data={openPositionsByExpiration} layout="vertical" margin={{ left: 10, right: 60, top: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" horizontal={false} />
                  <XAxis type="number" stroke="#71717a" fontSize={10} allowDecimals={false} />
                  <YAxis dataKey="expires" type="category" stroke="#71717a" fontSize={10} width={68} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(v, name) => [v + ' contracts', name === 'puts' ? 'Short Puts' : 'Covered Calls']}
                  />
                  <Legend
                    verticalAlign="top"
                    height={36}
                    iconType="circle"
                    formatter={(v) => v === 'puts' ? 'Short Puts' : 'Covered Calls'}
                    wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: '#a1a1aa' }}
                  />
                  <Bar dataKey="puts" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="calls" stackId="a" fill="#38bdf8" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="total"
                      position="right"
                      style={{ fill: '#fafafa', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Notional risk by expiration date */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Notional Risk</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">By Expiration</div>
              <ResponsiveContainer width="100%" height={Math.max(300, notionalRiskByExpiration.length * 36)}>
                <BarChart data={notionalRiskByExpiration} layout="vertical" margin={{ left: 10, right: 75, top: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" horizontal={false} />
                  <XAxis type="number" stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <YAxis dataKey="expires" type="category" stroke="#71717a" fontSize={10} width={68} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={TOOLTIP_STYLE.contentStyle}>
                          <div style={TOOLTIP_STYLE.labelStyle}>{d.expires}</div>
                          <div style={TOOLTIP_STYLE.itemStyle}>Notional Risk: {fmtCurrencyWhole(d.capitalAtRisk)}</div>
                          <div style={TOOLTIP_STYLE.itemStyle}>Contracts: {d.puts}</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="capitalAtRisk" fill="#fb7185" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="capitalAtRisk"
                      position="right"
                      formatter={(v) => fmtCurrencyWhole(v)}
                      style={{ fill: '#fafafa', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Notional risk by ticker */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Notional Risk</div>
              <div className="font-serif text-xl sm:text-2xl font-semibold mb-4">By Ticker</div>
              <ResponsiveContainer width="100%" height={Math.max(300, notionalByTicker.length * 28)}>
                <BarChart data={notionalByTicker} layout="vertical" margin={{ left: 10, right: 75, top: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 2" horizontal={false} />
                  <XAxis type="number" stroke="#71717a" fontSize={10} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <YAxis dataKey="ticker" type="category" stroke="#71717a" fontSize={10} width={50} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={TOOLTIP_STYLE.contentStyle}>
                          <div style={TOOLTIP_STYLE.labelStyle}>{d.ticker}</div>
                          <div style={TOOLTIP_STYLE.itemStyle}>Notional Risk: {fmtCurrencyWhole(d.notional)}</div>
                          <div style={TOOLTIP_STYLE.itemStyle}>Contracts: {d.contracts}</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="notional" fill="#fb7185" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="notional"
                      position="right"
                      formatter={(v) => fmtCurrencyWhole(v)}
                      style={{ fill: '#fafafa', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 500 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* RISK SCENARIOS */}
        {activeView === 'scenarios' && (
          <div className="space-y-6">
            <div>
              <div className="text-xs font-mono uppercase tracking-[0.2em] text-amber-500/80">Stress Test</div>
              <div className="font-serif text-2xl sm:text-3xl font-bold mt-1">Drawdown Scenarios</div>
              <div className="text-xs sm:text-sm text-zinc-500 mt-2 font-mono">
                If the underlying drops by each amount, how much capital would be deployed to take assignment on your {scenarios[0]?.totalCount || 0} open short puts?
                Capital deployed = strike × 100 × contracts for each ITM position. Covered calls excluded.
              </div>
            </div>

            {/* Notes */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-3">Assumptions</div>
              <ul className="text-xs text-zinc-400 font-mono space-y-1 leading-relaxed">
                <li>· Drawdown applied uniformly across all underlyings.</li>
                <li>· Assumes assignment at expiration at the stressed price.</li>
                <li>· Capital deployed = strike × 100 × contracts.</li>
                <li>· Paper loss = mark-to-market intrinsic if assigned at the stressed price, (strike − price) × 100 × contracts; it ignores premium already collected.</li>
                <li>· Paper loss is unrealized and could recover before expiration.</li>
              </ul>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {scenarios.map(s => {
                const totalCapital = scenarios[scenarios.length - 1].totalCount > 0
                  ? TRADES.filter(t => t.status === 'IN PLAY' && t.type === 'Short Put').reduce((sum, t) => sum + (t.riskLevel || 0), 0)
                  : 0;
                const pctDeployed = totalCapital > 0 ? (s.totalAssignedCapital / totalCapital) * 100 : 0;
                const severity = s.assignedCount === 0
                  ? 'safe'
                  : pctDeployed < 25
                  ? 'mixed'
                  : pctDeployed < 50
                  ? 'warn'
                  : pctDeployed < 80
                  ? 'danger'
                  : 'critical';
                const accents = {
                  safe:     { border: 'border-emerald-800/40', bg: 'bg-emerald-900/10',  num: 'text-emerald-400', label: 'text-emerald-500/80' },
                  mixed:    { border: 'border-amber-800/40',   bg: 'bg-amber-900/10',    num: 'text-amber-400',   label: 'text-amber-500/80' },
                  warn:     { border: 'border-orange-800/40',  bg: 'bg-orange-900/10',   num: 'text-orange-400',  label: 'text-orange-500/80' },
                  danger:   { border: 'border-rose-800/40',    bg: 'bg-rose-900/15',     num: 'text-rose-400',    label: 'text-rose-500/80' },
                  critical: { border: 'border-red-700/60',     bg: 'bg-red-900/20',      num: 'text-red-400',     label: 'text-red-500/80' },
                };
                const a = accents[severity];
                return (
                  <div key={s.drawdown} className={`${a.border} ${a.bg} border rounded-xl p-5`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className={`text-xs font-mono uppercase tracking-wider ${a.label}`}>−{s.drawdown}% Drawdown</div>
                      <TrendingDown size={14} className={a.num} />
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Capital Deployed</div>
                    <div className={`font-serif text-3xl font-bold num ${a.num}`}>
                      {fmtCurrencyWhole(s.totalAssignedCapital)}
                    </div>
                    <div className="text-xs font-mono text-zinc-500 mt-2 leading-relaxed">
                      <div>
                        <span className={`${a.num} font-semibold`}>{s.assignedCount}</span>
                        <span className="text-zinc-600"> / {s.totalCount}</span>
                        <span className="ml-1">assigned</span>
                      </div>
                      <div className="mt-0.5">
                        <span className={s.assignedCount > 0 ? 'text-rose-400' : 'text-zinc-400'}>{fmtCurrency(s.totalLoss)}</span>{' '}
                        <span className="text-zinc-600">paper loss</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Assignment matrix */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="p-4 sm:p-6 pb-3">
                <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Assignment Matrix</div>
                <div className="font-serif text-xl sm:text-2xl font-semibold">Per-Position by Drawdown</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900 border-y border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-3 py-3 text-left">Ticker</th>
                      <th className="px-3 py-3 text-right">Strike</th>
                      <th className="px-3 py-3 text-right">Price</th>
                      <th className="px-3 py-3 text-right">Buffer</th>
                      {scenarios.map(s => (
                        <th key={s.drawdown} className="px-3 py-3 text-center">−{s.drawdown}%</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TRADES.filter(t => t.status === 'IN PLAY' && t.type === 'Short Put' && t.price)
                      .sort((a, b) => (a.buffer || 0) - (b.buffer || 0))
                      .map((t, i) => (
                        <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-900/60 transition-colors">
                          <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">
                            {t.ticker} <span className="text-zinc-500 font-normal">{t.contracts}×</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono num text-zinc-400">${t.strike}</td>
                          <td className="px-3 py-2 text-right font-mono num text-zinc-400">${t.price.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-mono num text-xs">
                            <span className={riskColor(t.riskCategory)}>{fmtPct(t.buffer)}</span>
                          </td>
                          {scenarios.map(s => {
                            const newPrice = t.price * (1 - s.drawdown / 100);
                            const assigned = newPrice < t.strike;
                            return (
                              <td key={s.drawdown} className="px-3 py-2 text-center">
                                {assigned ? (
                                  <span className="inline-flex items-center gap-1 text-rose-400 font-mono text-[11px]">
                                    <span>●</span>
                                  </span>
                                ) : (
                                  <span className="text-zinc-700 font-mono text-[11px]">○</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                  <tfoot className="bg-zinc-900/60 border-t border-zinc-800">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                        Assigned count
                      </td>
                      {scenarios.map(s => (
                        <td key={s.drawdown} className="px-3 py-2 text-center font-mono text-xs font-semibold text-zinc-200">
                          {s.assignedCount}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                        Capital deployed
                      </td>
                      {scenarios.map(s => (
                        <td key={s.drawdown} className="px-3 py-2 text-center font-mono text-xs font-semibold text-zinc-200">
                          {s.totalAssignedCapital > 0 ? `$${(s.totalAssignedCapital / 1000).toFixed(0)}k` : '—'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                        Paper loss
                      </td>
                      {scenarios.map(s => (
                        <td key={s.drawdown} className="px-3 py-2 text-center font-mono text-xs font-semibold text-rose-400">
                          {s.totalLoss > 0 ? `-$${(s.totalLoss / 1000).toFixed(1)}k` : '—'}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="px-4 sm:px-6 py-3 text-[10px] font-mono text-zinc-600 border-t border-zinc-800">
                Sorted by buffer ascending · <span className="text-rose-400">●</span> assigned · <span className="text-zinc-600">○</span> safe
              </div>
            </div>
          </div>
        )}

        {/* $1M GOAL */}
        {activeView === 'goal' && (() => {
          const GOAL = 1_000_000;
          const WIN_RATE = 0.88;
          const AVG_WIN = 600;
          const AVG_LOSS = 1400;
          const EV_PER_TRADE = WIN_RATE * AVG_WIN - (1 - WIN_RATE) * AVG_LOSS; // $360
          const realized = stats.totalGain;
          const remaining = Math.max(0, GOAL - realized);
          const pctGoal = Math.min(100, (realized / GOAL) * 100);
          const tradesNeededRemaining = EV_PER_TRADE > 0 ? Math.ceil(remaining / EV_PER_TRADE) : 0;
          const totalTradesForecast = stats.totalTrades + tradesNeededRemaining;
          const pctTradesDone = Math.min(100, (stats.totalTrades / totalTradesForecast) * 100);

          // Months elapsed: from earliest acquired to today; today derived from latest closedOn or acquired
          const acquiredDates = TRADES.map(t => parseDate(t.acquired)).filter(Boolean);
          const closedDates = TRADES.map(t => parseDate(t.closedOn)).filter(Boolean);
          const startDate = acquiredDates.length ? new Date(Math.min(...acquiredDates.map(d => d.getTime()))) : null;
          const asOfDate = closedDates.length
            ? new Date(Math.max(...closedDates.map(d => d.getTime()), ...acquiredDates.map(d => d.getTime())))
            : (acquiredDates.length ? new Date(Math.max(...acquiredDates.map(d => d.getTime()))) : new Date());
          const monthsElapsed = startDate
            ? Math.max(1, (asOfDate.getFullYear() - startDate.getFullYear()) * 12 + (asOfDate.getMonth() - startDate.getMonth()) + 1)
            : 1;
          const tradesPerMonth = stats.totalTrades / monthsElapsed;
          const monthsRemaining = tradesPerMonth > 0 ? Math.ceil(tradesNeededRemaining / tradesPerMonth) : 0;
          const totalMonthsForecast = monthsElapsed + monthsRemaining;
          const yearsRemaining = monthsRemaining / 12;
          const pctMonthsDone = Math.min(100, (monthsElapsed / totalMonthsForecast) * 100);

          // Accelerated scenario: capital compounds (long book grows, monthly contributions,
          // enabling more CCs on more shares + margin-backed larger notional on puts).
          // Long-book appreciation does NOT count toward $1M — only options-generated P&L does.
          const LONG_BOOK_START = 900_000;
          const OPTIONS_CAPITAL_START = 945_000;  // current notional
          const LONG_BOOK_GROWTH_ANNUAL = 0.07;
          const MONTHLY_CONTRIBUTION = 18_000;
          const TARGET_PACE = 25.0;   // trades/month max
          const MAX_EV_TRADE = 900;    // EV/trade cap
          const BASE_CAPITAL = LONG_BOOK_START + OPTIONS_CAPITAL_START;
          // Year-by-year (actually month-by-month) simulation
          const accelSim = (() => {
            let realizedOpts = 0;
            let longBook = LONG_BOOK_START;
            let optionsCap = OPTIONS_CAPITAL_START;
            let m = 0;
            const evSeries = [], paceSeries = [];
            let capitalAtGoal = 0;
            while (realizedOpts < remaining && m < 240) {
              m += 1;
              longBook *= (1 + LONG_BOOK_GROWTH_ANNUAL / 12);
              longBook += MONTHLY_CONTRIBUTION / 2;
              optionsCap += MONTHLY_CONTRIBUTION / 2;
              const totalCap = longBook + optionsCap;
              const capRatio = totalCap / BASE_CAPITAL;
              const ev = Math.min(MAX_EV_TRADE, EV_PER_TRADE * capRatio);
              const pace = Math.min(TARGET_PACE, tradesPerMonth + (TARGET_PACE - tradesPerMonth) * (capRatio - 1.0));
              realizedOpts += ev * pace;
              evSeries.push(ev); paceSeries.push(pace);
              capitalAtGoal = totalCap;
            }
            const totalTrades = paceSeries.reduce((a,b) => a+b, 0);
            const avgEv = evSeries.length ? evSeries.reduce((a,b) => a+b, 0) / evSeries.length : EV_PER_TRADE;
            const avgPace = paceSeries.length ? paceSeries.reduce((a,b) => a+b, 0) / paceSeries.length : tradesPerMonth;
            return { months: m, totalTrades: Math.round(totalTrades), avgEv, avgPace, capitalAtGoal, endEv: evSeries[evSeries.length-1] || EV_PER_TRADE, endPace: paceSeries[paceSeries.length-1] || tradesPerMonth };
          })();

          const tradesNeededAccel = accelSim.totalTrades;
          const totalTradesAccel = stats.totalTrades + tradesNeededAccel;
          const monthsRemainingAccel = accelSim.months;
          const totalMonthsAccel = monthsElapsed + monthsRemainingAccel;
          const yearsRemainingAccel = monthsRemainingAccel / 12;
          const pctMonthsDoneAccel = Math.min(100, (monthsElapsed / totalMonthsAccel) * 100);
          const avgEvAccel = accelSim.avgEv;
          const capitalAtGoalM = (accelSim.capitalAtGoal / 1_000_000).toFixed(2);
          const endEvAccel = accelSim.endEv;
          const endPaceAccel = accelSim.endPace;
          return (
            <div className="space-y-6">
              {/* $1M Goal progress (headline, always at top) */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Realized P&L Toward $1M</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold">{fmtCurrency(realized)} <span className="text-zinc-500 text-lg font-mono font-normal">/ {fmtCurrencyWhole(GOAL)}</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Complete</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold text-amber-500">{pctGoal.toFixed(2)}%</div>
                  </div>
                </div>
                <div className="w-full h-4 bg-zinc-800 rounded-full overflow-hidden mt-4 border border-zinc-700">
                  <div className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all" style={{ width: `${pctGoal}%` }}></div>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500 mt-2">
                  <span>$0</span>
                  <span>Remaining: {fmtCurrencyWhole(remaining)}</span>
                  <span>$1M</span>
                </div>
              </div>

              {/* Factual stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Realized P&L" value={fmtCurrency(realized)} sublabel={`${pctGoal.toFixed(2)}% of goal`} accent="amber" />
                <StatCard label="Trades Closed" value={stats.closed.toLocaleString()} sublabel={`${stats.wins} won · ${stats.losses} lost`} accent="emerald" />
                <StatCard label="Trades In Play" value={stats.inPlay.toLocaleString()} sublabel={`${stats.inPlayShortPuts} puts · ${stats.inPlayCoveredCalls} calls`} accent="sky" />
                <StatCard label="Months Elapsed" value={monthsElapsed.toLocaleString()} sublabel={`${tradesPerMonth.toFixed(1)} trades/month pace`} accent="blue" />
              </div>

              {/* ==================== SCENARIO A ==================== */}
              <div className="pt-4">
                <div className="flex items-baseline gap-3 mb-3 border-b border-zinc-800 pb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-violet-400 px-2 py-0.5 border border-violet-500/40 rounded">Scenario A</span>
                  <h2 className="font-serif text-xl sm:text-2xl font-semibold">Stay as is</h2>
                  <span className="text-xs font-mono text-zinc-500">— current profile, no compounding</span>
                </div>
              </div>

              {/* Scenario A: Assumptions */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-3">Assumptions · Scenario A</div>
                <ul className="text-xs text-zinc-400 font-mono space-y-1 leading-relaxed">
                  <li>· Win rate: <span className="text-zinc-200">{(WIN_RATE * 100).toFixed(0)}%</span> · Average win: <span className="text-zinc-200">${AVG_WIN}</span> · Average loss: <span className="text-zinc-200">${AVG_LOSS.toLocaleString()}</span>.</li>
                  <li>· Expected value per trade = 0.88 × $600 − 0.12 × $1,400 = <span className="text-zinc-200">${EV_PER_TRADE.toFixed(0)}</span> (held constant).</li>
                  <li>· Trade pace: <span className="text-zinc-200">{stats.totalTrades} trades over {monthsElapsed} months = {tradesPerMonth.toFixed(1)} trades/month</span>.</li>
                  <li>· Assumes the current trade profile persists — same mix of tickers, durations, buffers, outcomes, and account size.</li>
                  <li>· Ignores taxes, capital drawdowns, and any strategy shift.</li>
                </ul>
              </div>

              {/* Scenario A: Trades progress */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Trades Placed vs Estimated Total</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold">{stats.totalTrades} <span className="text-zinc-500 text-lg font-mono font-normal">/ ~{totalTradesForecast.toLocaleString()}</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Complete</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold text-sky-400">{pctTradesDone.toFixed(2)}%</div>
                  </div>
                </div>
                <div className="w-full h-4 bg-zinc-800 rounded-full overflow-hidden mt-4 border border-zinc-700 relative">
                  <div className="h-full bg-emerald-500 absolute left-0 top-0" style={{ width: `${(stats.closed / totalTradesForecast) * 100}%` }}></div>
                  <div className="h-full bg-sky-500 absolute top-0" style={{ left: `${(stats.closed / totalTradesForecast) * 100}%`, width: `${(stats.inPlay / totalTradesForecast) * 100}%` }}></div>
                </div>
                <div className="flex flex-wrap gap-4 text-[11px] font-mono mt-3">
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500"></span><span className="text-zinc-400">Closed: <span className="text-zinc-200">{stats.closed}</span></span></span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-sky-500"></span><span className="text-zinc-400">In Play: <span className="text-zinc-200">{stats.inPlay}</span></span></span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-zinc-700 border border-zinc-600"></span><span className="text-zinc-400">Remaining to place: <span className="text-zinc-200">~{tradesNeededRemaining.toLocaleString()}</span></span></span>
                </div>
              </div>

              {/* Scenario A: Months progress */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Months Elapsed vs Est. Total</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold">{monthsElapsed} <span className="text-zinc-500 text-lg font-mono font-normal">/ ~{totalMonthsForecast.toLocaleString()} months ({(totalMonthsForecast / 12).toFixed(1)} yrs)</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Complete</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold text-violet-400">{pctMonthsDone.toFixed(2)}%</div>
                  </div>
                </div>
                <div className="w-full h-4 bg-zinc-800 rounded-full overflow-hidden mt-4 border border-zinc-700">
                  <div className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all" style={{ width: `${pctMonthsDone}%` }}></div>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500 mt-2">
                  <span>Month 1</span>
                  <span>At {tradesPerMonth.toFixed(1)} trades/mo · ~{monthsRemaining.toLocaleString()} months (~{yearsRemaining.toFixed(1)} yrs) remaining</span>
                  <span>Month ~{totalMonthsForecast.toLocaleString()}</span>
                </div>
              </div>

              {/* ==================== SCENARIO B ==================== */}
              <div className="pt-4">
                <div className="flex items-baseline gap-3 mb-3 border-b border-zinc-800 pb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-fuchsia-400 px-2 py-0.5 border border-fuchsia-500/40 rounded">Scenario B</span>
                  <h2 className="font-serif text-xl sm:text-2xl font-semibold">Capital compounds (aggressive, grounded)</h2>
                  <span className="text-xs font-mono text-zinc-500">— long book grows, monthly contributions, margin scales notional</span>
                </div>
              </div>

              {/* Scenario B: Assumptions */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-3">Assumptions · Scenario B</div>
                <ul className="text-xs text-zinc-400 font-mono space-y-1 leading-relaxed">
                  <li>· <span className="text-zinc-300">Starting capital base:</span> <span className="text-zinc-200">$900k long portfolio</span> + <span className="text-zinc-200">~$945k options collateral</span> = <span className="text-zinc-200">~$1.85M</span>.</li>
                  <li>· <span className="text-zinc-300">Long-book growth:</span> <span className="text-zinc-200">7%/yr</span> — compounds the capital base (enables more CCs on more shares + more margin-backed put notional). <span className="text-zinc-300">Does NOT credit toward the $1M goal.</span></li>
                  <li>· <span className="text-zinc-300">Contributions:</span> <span className="text-zinc-200">$18k/month (~$216k/yr)</span>, split 50/50 into long book and options collateral.</li>
                  <li>· <span className="text-zinc-300">Trade pace scales:</span> from today's <span className="text-zinc-200">{tradesPerMonth.toFixed(1)}/month</span> up to <span className="text-zinc-200">25/month</span> as capital grows (more CCs on growing share base + margin allows more concurrent puts).</li>
                  <li>· <span className="text-zinc-300">EV per trade scales:</span> proportional to capital-base ratio, capped at <span className="text-zinc-200">${MAX_EV_TRADE}</span> — bigger positions with margin, larger premium per contract.</li>
                  <li>· <span className="text-zinc-300">Only options-premium P&L counts toward $1M.</span> Long-book appreciation, contributions, and stock returns on assigned positions all excluded from the goal (they only grow the capital base that enables the options engine).</li>
                  <li>· Simulation result: reaches $1M in <span className="text-zinc-200">~{monthsRemainingAccel} months (~{yearsRemainingAccel.toFixed(1)} yrs)</span>, with capital base grown to <span className="text-zinc-200">~${capitalAtGoalM}M</span>, avg EV <span className="text-zinc-200">${avgEvAccel.toFixed(0)}/trade</span>, ending at <span className="text-zinc-200">${endEvAccel.toFixed(0)}/trade at {endPaceAccel.toFixed(1)}/mo</span>.</li>
                  <li>· Ignores taxes, drawdowns, and further strategy shifts.</li>
                </ul>
              </div>

              {/* Scenario B: Trades progress */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Trades Placed vs Estimated Total (Accelerated)</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold">{stats.totalTrades} <span className="text-zinc-500 text-lg font-mono font-normal">/ ~{totalTradesAccel.toLocaleString()}</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Complete</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold text-fuchsia-400">{((stats.totalTrades / totalTradesAccel) * 100).toFixed(2)}%</div>
                  </div>
                </div>
                <div className="w-full h-4 bg-zinc-800 rounded-full overflow-hidden mt-4 border border-zinc-700 relative">
                  <div className="h-full bg-emerald-500 absolute left-0 top-0" style={{ width: `${(stats.closed / totalTradesAccel) * 100}%` }}></div>
                  <div className="h-full bg-sky-500 absolute top-0" style={{ left: `${(stats.closed / totalTradesAccel) * 100}%`, width: `${(stats.inPlay / totalTradesAccel) * 100}%` }}></div>
                </div>
                <div className="flex flex-wrap gap-4 text-[11px] font-mono mt-3">
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-emerald-500"></span><span className="text-zinc-400">Closed: <span className="text-zinc-200">{stats.closed}</span></span></span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-sky-500"></span><span className="text-zinc-400">In Play: <span className="text-zinc-200">{stats.inPlay}</span></span></span>
                  <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-zinc-700 border border-zinc-600"></span><span className="text-zinc-400">Remaining to place: <span className="text-zinc-200">~{tradesNeededAccel.toLocaleString()}</span></span></span>
                </div>
              </div>

              {/* Scenario B: Months progress */}
              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Months Elapsed vs Est. Total (Accelerated)</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold">{monthsElapsed} <span className="text-zinc-500 text-lg font-mono font-normal">/ ~{totalMonthsAccel.toLocaleString()} months ({(totalMonthsAccel / 12).toFixed(1)} yrs)</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono uppercase tracking-wider text-zinc-500 mb-1">Complete</div>
                    <div className="font-serif text-2xl sm:text-3xl font-semibold text-fuchsia-400">{pctMonthsDoneAccel.toFixed(2)}%</div>
                  </div>
                </div>
                <div className="w-full h-4 bg-zinc-800 rounded-full overflow-hidden mt-4 border border-zinc-700">
                  <div className="h-full bg-gradient-to-r from-fuchsia-600 to-fuchsia-400 transition-all" style={{ width: `${pctMonthsDoneAccel}%` }}></div>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500 mt-2">
                  <span>Month 1</span>
                  <span>EV grows ${EV_PER_TRADE.toFixed(0)} → ${endEvAccel.toFixed(0)}/trade · pace grows {tradesPerMonth.toFixed(1)} → {endPaceAccel.toFixed(1)}/mo · ~{monthsRemainingAccel.toLocaleString()} months (~{yearsRemainingAccel.toFixed(1)} yrs) remaining</span>
                  <span>Month ~{totalMonthsAccel.toLocaleString()}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-zinc-800 text-center text-xs font-mono text-zinc-600">
          {stats.totalTrades} trades tracked · {stats.closed} closed · {stats.inPlay} in play
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sublabel, accent, icon: Icon, large }) {
  const accents = {
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    amber: 'text-amber-400',
    sky: 'text-sky-400',
    blue: 'text-blue-400',
  };
  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">{label}</div>
        {Icon && <Icon size={16} className={accents[accent]} />}
      </div>
      <div className={`font-serif ${large ? 'text-3xl' : 'text-2xl'} font-bold num ${accents[accent]}`}>
        {value}
      </div>
      <div className="text-xs font-mono text-zinc-500 mt-2">{sublabel}</div>
    </div>
  );
}

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="flex gap-0.5 bg-zinc-950 border border-zinc-800 rounded-md p-0.5">
        {options.map(o => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              value === o.id
                ? o.color === 'emerald' ? 'bg-emerald-500/20 text-emerald-300'
                : o.color === 'rose' ? 'bg-rose-500/20 text-rose-300'
                : o.color === 'sky' ? 'bg-sky-500/20 text-sky-300'
                : o.color === 'zinc' ? 'bg-zinc-700/50 text-zinc-200'
                : 'bg-amber-500 text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortableTh({ label, k, sortKey, sortDir, onSort, right }) {
  const active = sortKey === k;
  return (
    <th className={`px-3 py-3 ${right ? 'text-right' : 'text-left'} select-none`}>
      <button
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-zinc-200 transition-colors ${active ? 'text-amber-400' : ''}`}
      >
        {label}
        <ArrowUpDown size={10} />
      </button>
    </th>
  );
}

function LedgerHeader({ statusFilter, setStatusFilter, outcomeFilter, setOutcomeFilter, bufferLevels, setBufferLevels, search, setSearch, count, total, statsRow }) {
  const toggleBufferLevel = (level) => {
    setBufferLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  };
  const allLevels = ['Very Safe', 'Safe', 'Alert', 'Danger', 'ITM', 'Deep ITM'];

  return (
    <>
      <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 mb-3">
        {/* Row 1: Status pills + Buffer pills left, stats right */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterGroup
            label="Status"
            options={[
              { id: 'all', label: 'All' },
              { id: 'in_play', label: 'In Play', color: 'sky' },
              { id: 'closed', label: 'Closed', color: 'zinc' },
            ]}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); if (v !== 'closed') setOutcomeFilter('all'); }}
          />
          {statusFilter === 'closed' && (
            <FilterGroup
              label="Outcome"
              options={[
                { id: 'all', label: 'All' },
                { id: 'won', label: 'Won', color: 'emerald' },
                { id: 'lost', label: 'Lost', color: 'rose' },
              ]}
              value={outcomeFilter}
              onChange={setOutcomeFilter}
            />
          )}
          {statusFilter === 'in_play' && (
            <div className="flex items-center gap-2 max-w-full overflow-x-auto">
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-500 shrink-0">Buffer</span>
              <div className="flex gap-0.5 bg-zinc-950 border border-zinc-800 rounded-md p-0.5 shrink-0">
                {allLevels.map(level => {
                  const selected = bufferLevels.includes(level);
                  const colorClasses = {
                    'Very Safe': selected ? 'bg-green-700/30 text-green-300' : 'text-zinc-500 hover:text-zinc-300',
                    'Safe': selected ? 'bg-green-500/20 text-green-300' : 'text-zinc-500 hover:text-zinc-300',
                    'Alert': selected ? 'bg-yellow-500/20 text-yellow-300' : 'text-zinc-500 hover:text-zinc-300',
                    'Danger': selected ? 'bg-orange-500/20 text-orange-300' : 'text-zinc-500 hover:text-zinc-300',
                    'ITM': selected ? 'bg-red-500/20 text-red-300' : 'text-zinc-500 hover:text-zinc-300',
                    'Deep ITM': selected ? 'bg-red-800/40 text-red-200' : 'text-zinc-500 hover:text-zinc-300',
                  };
                  return (
                    <button
                      key={level}
                      onClick={() => toggleBufferLevel(level)}
                      className={`px-2 sm:px-3 py-1 text-xs font-medium rounded transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${colorClasses[level]}`}
                    >
                      <span>{bufferIcon(level)}</span>
                      <span>{level}</span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setBufferLevels([])}
                disabled={bufferLevels.length === 0}
                className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 shrink-0"
              >
                Clear
              </button>
            </div>
          )}
          <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-3 sm:gap-4 flex-wrap">
            {statsRow}
          </div>
        </div>
      </div>

      {/* Row 2 — outside the widget, no border */}
      <div className="flex items-center gap-3 mb-3 px-1">
        <div className="text-xs font-mono text-zinc-500 whitespace-nowrap">
          <span className="text-zinc-200 font-semibold">{count}</span>
          <span className="text-zinc-600"> / {total}</span>
          <span className="ml-2 uppercase tracking-wider">trades shown</span>
        </div>
        <div className="relative ml-auto w-56 sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticker..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500 placeholder:text-zinc-600"
          />
        </div>
      </div>
    </>
  );
}

// Compact inline stat for the header row
function InlineStat({ label, value, accent }) {
  const accents = {
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    amber: 'text-amber-400',
    sky: 'text-sky-400',
    zinc: 'text-zinc-200',
  };
  return (
    <div className="text-left sm:text-right">
      <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono num text-sm font-semibold ${accents[accent] || 'text-zinc-200'}`}>{value}</div>
    </div>
  );
}

// SHORT PUTS LEDGER — includes risk capital, risk category, and annualized yield
function TradeLedger({ trades, totalCount, strategy, statusFilter, setStatusFilter, outcomeFilter, setOutcomeFilter, bufferLevels, setBufferLevels, search, setSearch, sortKey, sortDir, handleSort, statusColor, riskColor }) {
  // Live stats based on currently filtered trades
  const closed = trades.filter(t => t.status !== 'IN PLAY');
  const inPlay = trades.filter(t => t.status === 'IN PLAY');
  const wins = closed.filter(t => t.gainLoss > 0).length;
  const losses = closed.filter(t => t.gainLoss < 0).length;
  const totalPnL = closed.reduce((s, t) => s + t.gainLoss, 0);
  const totalRisk = inPlay.reduce((s, t) => s + (t.riskLevel || 0), 0);
  const totalPremium = inPlay.reduce((s, t) => s + (t.premium || 0), 0);

  // Which stats to show depends on what's filtered
  const showInPlayStats = statusFilter === 'all' || statusFilter === 'in_play';
  const showClosedStats = statusFilter === 'all' || statusFilter === 'closed';

  return (
    <div>
      {/* Title */}
      <div className="mb-4">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-amber-500/80">Strategy</div>
        <div className="font-serif text-2xl sm:text-3xl font-bold mt-1">Short Puts</div>
      </div>

      {/* Filter + Stats header */}
      <LedgerHeader
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        outcomeFilter={outcomeFilter} setOutcomeFilter={setOutcomeFilter}
        bufferLevels={bufferLevels} setBufferLevels={setBufferLevels}
        search={search} setSearch={setSearch}
        count={trades.length} total={totalCount}
        statsRow={
          <>
            {showInPlayStats && (
              <>
                <InlineStat label="Premium In Play" value={fmtCurrency(totalPremium)} accent="amber" />
                <InlineStat label="Notional Risk" value={fmtCurrencyWhole(totalRisk)} accent="zinc" />
              </>
            )}
            {showClosedStats && (
              <>
                <InlineStat label="Realized P&L" value={fmtCurrency(totalPnL)} accent={totalPnL >= 0 ? 'emerald' : 'rose'} />
                {statusFilter === 'all' && (
                  <InlineStat label="In Play" value={inPlay.length} accent="sky" />
                )}
                <InlineStat label="Won" value={wins} accent="emerald" />
                <InlineStat label="Lost" value={losses} accent="rose" />
              </>
            )}
          </>
        }
      />

      {/* Table */}
      <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <SortableTh label="Ticker" k="ticker" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <th className="px-3 py-3 text-left">Status</th>
                <SortableTh label="Strike" k="strike" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                <th className="px-3 py-3 text-right">Current Price</th>
                <SortableTh label="Acquired" k="acquired" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Expires" k="expires" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Premium / P&L" k="premium" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                <SortableTh label="Notional Risk" k="riskLevel" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                <SortableTh label="Buffer %" k="buffer" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                <SortableTh label="Buffer Level" k="riskCategory" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                <SortableTh
                  label={statusFilter === 'in_play' ? 'Est. Yield (Ann.)' : statusFilter === 'closed' ? 'Real Yield (Ann.)' : 'Yield (Ann.)'}
                  k="estYield" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right
                />
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => {
                const isInPlay = t.status === 'IN PLAY';
                const pnl = t.gainLoss;
                return (
                  <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-900/60 transition-colors">
                    <td className="px-3 py-3 font-mono font-semibold whitespace-nowrap">
                      {t.ticker} <span className="text-zinc-500 font-normal">{t.contracts}×</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border ${statusColor(t.status)}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono num">${t.strike}</td>
                    <td className="px-3 py-3 text-right font-mono num text-xs">
                      {isInPlay && t.price ? (
                        <span className="text-zinc-200">${t.price.toFixed(2)}</span>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{t.acquired}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{t.expires}</td>
                    <td className="px-3 py-3 text-right font-mono num">
                      {isInPlay ? (
                        <span className="text-amber-400">{fmtCurrency(t.premium)}</span>
                      ) : (
                        <span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {pnl >= 0 ? '+' : ''}{fmtCurrency(pnl)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono num text-xs text-zinc-400">
                      {t.riskLevel ? fmtCurrencyWhole(t.riskLevel) : t.capital ? fmtCurrencyWhole(t.capital) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">
                      {isInPlay && t.buffer !== undefined && t.buffer !== null ? (
                        <span className={riskColor(t.riskCategory)}>{fmtPct(t.buffer)}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">
                      {isInPlay && t.riskCategory ? (
                        <span className={`inline-flex items-center gap-1.5 ${riskColor(t.riskCategory)}`}>
                          <span>{bufferIcon(t.riskCategory)}</span>
                          <span>{t.riskCategory}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono num text-xs text-zinc-400">
                      {isInPlay ? fmtPct(t.estYield) : fmtPct(t.realYield)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {trades.length === 0 && (
            <div className="p-8 text-center text-zinc-500 text-sm">No trades match filters</div>
          )}
        </div>
      </div>
    </div>
  );
}

// COVERED CALLS LEDGER — no risk/yield, focused on premium and outcome
function CallsLedger({ trades, totalCount, statusFilter, setStatusFilter, outcomeFilter, setOutcomeFilter, bufferLevels, setBufferLevels, search, setSearch, sortKey, sortDir, handleSort, statusColor, riskColor }) {
  const closed = trades.filter(t => t.status !== 'IN PLAY');
  const inPlay = trades.filter(t => t.status === 'IN PLAY');
  const totalPnL = closed.reduce((s, t) => s + t.gainLoss, 0);
  const totalPremium = inPlay.reduce((s, t) => s + (t.premium || 0), 0);
  const wins = closed.filter(t => t.gainLoss > 0).length;
  const losses = closed.filter(t => t.gainLoss < 0).length;

  return (
    <div>
      {/* Title */}
      <div className="mb-4">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-amber-500/80">Strategy</div>
        <div className="font-serif text-2xl sm:text-3xl font-bold mt-1">Covered Calls</div>
      </div>

      {/* Filter + Stats header */}
      <LedgerHeader
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        outcomeFilter={outcomeFilter} setOutcomeFilter={setOutcomeFilter}
        bufferLevels={bufferLevels} setBufferLevels={setBufferLevels}
        search={search} setSearch={setSearch}
        count={trades.length} total={totalCount}
        statsRow={
          <>
            {(statusFilter === 'all' || statusFilter === 'in_play') && (
              <InlineStat label="Premium In Play" value={fmtCurrency(totalPremium)} accent="amber" />
            )}
            {(statusFilter === 'all' || statusFilter === 'closed') && (
              <>
                <InlineStat label="Realized P&L" value={fmtCurrency(totalPnL)} accent={totalPnL >= 0 ? 'emerald' : 'rose'} />
                {statusFilter === 'all' && (
                  <InlineStat label="In Play" value={inPlay.length} accent="sky" />
                )}
                <InlineStat label="Won" value={wins} accent="emerald" />
                <InlineStat label="Lost" value={losses} accent="rose" />
              </>
            )}
          </>
        }
      />

      <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <SortableTh label="Ticker" k="ticker" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <th className="px-3 py-3 text-left">Status</th>
                <SortableTh label="Strike" k="strike" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                <th className="px-3 py-3 text-right">Current Price</th>
                <SortableTh label="Acquired" k="acquired" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Expires" k="expires" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Closed On" k="closedOn" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableTh label="Premium / P&L" k="premium" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                <SortableTh label="Buffer %" k="buffer" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
                <SortableTh label="Buffer Level" k="riskCategory" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} right />
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => {
                const isInPlay = t.status === 'IN PLAY';
                const pnl = t.gainLoss;
                return (
                  <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-900/60 transition-colors">
                    <td className="px-3 py-3 font-mono font-semibold whitespace-nowrap">
                      {t.ticker} <span className="text-zinc-500 font-normal">{t.contracts}×</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border ${statusColor(t.status)}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono num">${t.strike}</td>
                    <td className="px-3 py-3 text-right font-mono num text-xs">
                      {isInPlay && t.price ? (
                        <span className="text-zinc-200">${t.price.toFixed(2)}</span>
                      ) : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{t.acquired}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{t.expires}</td>
                    <td className="px-3 py-3 font-mono text-xs text-zinc-400">{t.closedOn || '—'}</td>
                    <td className="px-3 py-3 text-right font-mono num">
                      {isInPlay ? (
                        <span className="text-amber-400">{fmtCurrency(t.premium)}</span>
                      ) : (
                        <span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {pnl >= 0 ? '+' : ''}{fmtCurrency(pnl)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">
                      {isInPlay && t.buffer !== undefined && t.buffer !== null ? (
                        <span className={riskColor(t.riskCategory)}>{fmtPct(t.buffer)}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs">
                      {isInPlay && t.riskCategory ? (
                        <span className={`inline-flex items-center gap-1.5 ${riskColor(t.riskCategory)}`}>
                          <span>{bufferIcon(t.riskCategory)}</span>
                          <span>{t.riskCategory}</span>
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {trades.length === 0 && (
            <div className="p-8 text-center text-zinc-500 text-sm">No trades match filters</div>
          )}
        </div>
      </div>
    </div>
  );
}
