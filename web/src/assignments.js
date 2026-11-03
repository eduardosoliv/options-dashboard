// Assignments & Called tracking: how shares performed after they were assigned
// (bought at the put strike) or called away (sold at the call strike), next to
// the S&P 500 over the same window. Lots come from trades.json; cost basis,
// proceeds and which shares are still held come from Fidelity lots; prices come
// from a hand-maintained price history (Fidelity has no API).

/**
 * @typedef {[string, number]} PricePoint ISO date (YYYY-MM-DD) and close.
 * @typedef {{ asOf: string, sample?: boolean, series: Record<string, PricePoint[]> }} PriceHistory
 * @typedef {{
 *   ticker: string,
 *   status: string,
 *   contracts: number | null,
 *   strike: number | null,
 *   closedOn: string | null,
 *   exitPrice?: number | null,
 *   premiumCollected?: number | null,
 *   type?: string,
 *   acquired?: string | null,
 *   gainLoss?: number | null,
 *   premium?: number | null,
 * }} TradeLike
 * @typedef {{ ticker: string, acquired: string, quantity: number, costBasis: number }} HeldLot
 * @typedef {HeldLot & { sold: string, proceeds: number }} SoldLot
 * @typedef {{ asOf: string, held: HeldLot[], sold: SoldLot[] }} Holdings Fidelity lots (totals, not per share).
 * @typedef {{ date: string, t: number, stock: number, spx: number }} LotPoint
 *   $ gain/loss on `date` (t = epoch ms for the chart axis): the shares vs `capital` in the S&P.
 * @typedef {{
 *   id: string,
 *   kind: 'assigned' | 'called',
 *   ticker: string,
 *   date: string,
 *   label: string,
 *   contracts: number,
 *   strikes: number[],
 *   premium: number | null,
 *   costPrice: number,
 *   shares: number,
 *   capital: number,
 *   atStrike: number,
 *   endDate: string,
 *   endedByCall: boolean,
 *   refPrice: number | null,
 *   refPct: number | null,
 *   points: LotPoint[],
 *   last: LotPoint,
 * }} Lot costPrice: per-share $ the line is measured from — Fidelity cost basis
 *   (assigned) or proceeds (called), else the market price on the event day;
 *   capital = costPrice × shares; atStrike = strike × shares (from the sheet); refPrice/refPct: Fidelity's per-share figure
 *   and the % gain vs it (null without a Fidelity match).
 * @typedef {{ stock: number, spx: number, excess: number, capital: number, atStrike: number, fromFidelity: boolean }} LotSummary
 *   $ totals; fromFidelity: every lot's capital is Fidelity's basis / proceeds,
 *   so capital − atStrike is the option premium.
 */

export const SPX = 'SPX';
const DAY_MS = 86_400_000;
const STEP_DAYS = 7;
// Fidelity dates a lot a day or so off the sheet's expiry date.
const MATCH_DAYS = 4;
const TRADE_DATE = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 'Feb 12, 26' (the sheet's format) → '2026-02-12'; null when unparseable.
 * @param {string | null | undefined} s
 * @returns {string | null}
 */
export function tradeDateToIso(s) {
  const m = TRADE_DATE.exec(s ?? '');
  if (!m) return null;
  const month = MONTHS.indexOf(m[1] ?? '');
  if (month < 0) return null;
  return `20${m[3]}-${String(month + 1).padStart(2, '0')}-${(m[2] ?? '').padStart(2, '0')}`;
}

/**
 * '2026-09-18' → 'Sep 18'.
 * @param {string} iso
 */
export const shortDate = (iso) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${Number(iso.slice(8, 10))}`;

/** @param {string} iso */
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);

/**
 * @param {string} iso
 * @param {number} days
 */
const addDays = (iso, days) => new Date(toMs(iso) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * @param {string} from
 * @param {string} to
 */
export const daysBetween = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY_MS);

/**
 * Last close on or before `iso` (series sorted ascending); null if none.
 * @param {PricePoint[] | undefined} series
 * @param {string} iso
 * @returns {number | null}
 */
export function closeOn(series, iso) {
  let close = null;
  for (const [date, value] of series ?? []) {
    if (date > iso) break;
    close = value;
  }
  return close;
}

/**
 * @typedef {{ key: string, ticker: string, date: string, label: string, contracts: number, strikes: number[], atStrike: number, premium: number | null, exitPrice: number | null }} EventGroup
 *   premium: summed option premium, null when any row lacks it.
 */

/**
 * @param {string} key
 * @param {string} ticker
 * @param {string} date
 * @param {string} label
 * @returns {EventGroup}
 */
const newGroup = (key, ticker, date, label) => ({
  key,
  ticker,
  date,
  label,
  contracts: 0,
  strikes: [],
  atStrike: 0,
  premium: 0,
  exitPrice: null,
});

/**
 * @param {EventGroup} g
 * @param {TradeLike} t
 */
function addToGroup(g, t) {
  g.contracts += t.contracts ?? 0;
  g.atStrike += (t.strike ?? 0) * 100 * (t.contracts ?? 0);
  if (t.strike !== null && !g.strikes.includes(t.strike)) {
    g.strikes.push(t.strike);
    g.strikes.sort((a, b) => a - b);
  }
  const premium = t.premiumCollected ?? null;
  g.premium = g.premium === null || premium === null ? null : g.premium + premium;
  g.exitPrice ??= t.exitPrice ?? null;
}

/**
 * Same-day rows for one ticker, status and strike merge into one lot; a
 * different strike is a different trade, so it gets its own lot.
 * @param {TradeLike[]} trades
 * @param {string} status
 */
function groupEvents(trades, status) {
  /** @type {Map<string, EventGroup>} */
  const groups = new Map();
  for (const t of trades) {
    const date = t.status === status ? tradeDateToIso(t.closedOn) : null;
    if (!(date && t.closedOn)) continue;
    const key = `${t.ticker}:${date}:${t.strike}`;
    const g = groups.get(key) ?? newGroup(key, t.ticker, date, t.closedOn);
    addToGroup(g, t);
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.ticker.localeCompare(b.ticker) ||
      (a.strikes[0] ?? 0) - (b.strikes[0] ?? 0),
  );
}

/**
 * Weekly calendar dates from `start` to `end`; every lot samples on this shared
 * grid so the lots can be added up into a total line.
 * @param {string} start
 * @param {string} end
 * @returns {string[]}
 */
function weeklyGrid(start, end) {
  const dates = [];
  for (let d = start; d < end; d = addDays(d, STEP_DAYS)) dates.push(d);
  return dates;
}

/**
 * Points on the lot's start date, the shared grid in between, and `endDate`:
 * $ gain of the shares vs `costPrice`, and of the same capital in the S&P.
 * @param {PriceHistory} prices
 * @param {string[]} grid
 * @param {{ ticker: string, date: string, endDate: string, costPrice: number, shares: number }} lot
 * @returns {LotPoint[]}
 */
function samplePoints(prices, grid, { ticker, date, endDate, costPrice, shares }) {
  const spxBase = closeOn(prices.series[SPX], date);
  const dates = [date, ...grid.filter((d) => d > date && d < endDate), endDate];
  /** @type {LotPoint[]} */
  const points = [];
  for (const at of new Set(dates)) {
    const stock = closeOn(prices.series[ticker], at);
    const spx = closeOn(prices.series[SPX], at);
    if (stock === null || spx === null || !spxBase) continue;
    points.push({
      date: at,
      t: toMs(at),
      stock: (stock - costPrice) * shares,
      spx: costPrice * shares * (spx / spxBase - 1),
    });
  }
  return points;
}

/**
 * @param {string} a
 * @param {string} b
 */
const near = (a, b) => Math.abs(daysBetween(a, b)) <= MATCH_DAYS;

/**
 * Per-share total over matching lots, or null when none match.
 * @template {HeldLot} T
 * @param {T[]} lots
 * @param {(l: T) => number} pick
 */
function perShare(lots, pick) {
  const qty = lots.reduce((s, l) => s + l.quantity, 0);
  return qty ? lots.reduce((s, l) => s + pick(l), 0) / qty : null;
}

/**
 * Fidelity lots for one event (already filtered to its ticker and day and to
 * lots no other event claimed): only lots on the right side of the strike —
 * cost basis below it for assignments (strike − premium), proceeds above it
 * for call-aways (strike + premium) — closest first, until the shares are
 * covered. "Closest" is to the expected per-share price — strike ∓ the
 * sheet's premium per share, which is what Fidelity books — or to the strike
 * when the premium is unknown. So same-day events at different strikes each
 * get their own lot, and a lot bought near the strike without a premium isn't
 * mistaken for one.
 * @template {HeldLot} T
 * @param {T[]} candidates
 * @param {{ contracts: number, strikes: number[], premium: number | null }} e
 * @param {(l: T) => number} total costBasis or proceeds
 * @param {'below' | 'above'} side
 * @returns {T[]}
 */
function pickByStrike(candidates, e, total, side) {
  const strike = e.strikes[0] ?? 0;
  const perSharePremium = e.premium === null ? 0 : e.premium / (e.contracts * 100);
  const target = side === 'below' ? strike - perSharePremium : strike + perSharePremium;
  const pps = (/** @type {T} */ l) => total(l) / l.quantity;
  const ok = (/** @type {T} */ l) => (side === 'below' ? pps(l) < strike : pps(l) > strike);
  const ranked = candidates
    .filter(ok)
    .sort((a, b) => Math.abs(pps(a) - target) - Math.abs(pps(b) - target));
  /** @type {T[]} */
  const picked = [];
  let qty = 0;
  for (const l of ranked) {
    if (qty >= e.contracts * 100) break;
    picked.push(l);
    qty += l.quantity;
  }
  return picked;
}

/**
 * Where the lot's line ends and what Fidelity says it cost / fetched; marks
 * the Fidelity lots it used in `claimed`.
 * Assigned: matched among held and sold lots acquired that day; ends at the
 * sale only when every matched lot was sold. Called: proceeds of the matching sale(s).
 * @param {Holdings} holdings
 * @param {'assigned' | 'called'} kind
 * @param {{ ticker: string, date: string, contracts: number, strikes: number[], premium: number | null }} e
 * @param {Set<HeldLot>} claimed
 * @returns {{ refPrice: number | null, soldOn: string | null }}
 */
function matchHoldings(holdings, kind, e, claimed) {
  const free = (/** @type {HeldLot} */ l) => l.ticker === e.ticker && !claimed.has(l);
  const cost = (/** @type {HeldLot} */ l) => l.costBasis;
  if (kind === 'called') {
    const sales = holdings.sold.filter((l) => free(l) && near(l.sold, e.date));
    const picked = pickByStrike(sales, e, (l) => l.proceeds, 'above');
    for (const l of picked) claimed.add(l);
    return { refPrice: perShare(picked, (l) => l.proceeds), soldOn: null };
  }
  /** @type {Array<HeldLot & { sold?: string }>} */
  const lots = [...holdings.held, ...holdings.sold].filter(
    (l) => free(l) && near(l.acquired, e.date),
  );
  const picked = pickByStrike(lots, e, cost, 'below');
  for (const l of picked) claimed.add(l);
  const allSold = picked.length > 0 && picked.every((l) => l.sold !== undefined);
  return { refPrice: perShare(picked, cost), soldOn: allSold ? (picked[0]?.sold ?? null) : null };
}

/**
 * @param {TradeLike[]} trades
 * @param {PriceHistory} prices
 * @param {'assigned' | 'called'} kind
 * @param {Holdings} [holdings]
 * @returns {{ lots: Lot[], missing: string[] }}
 */
export function buildLots(
  trades,
  prices,
  kind,
  holdings = { asOf: prices.asOf, held: [], sold: [] },
) {
  const events = groupEvents(trades, kind === 'assigned' ? 'ASSIGNED' : 'CALLED');
  const grid = weeklyGrid(events[0]?.date ?? prices.asOf, prices.asOf);
  /** @type {Lot[]} */
  const lots = [];
  /** @type {string[]} */
  const missing = [];
  /** @type {Set<HeldLot>} */
  const claimed = new Set();
  for (const e of events) {
    const { refPrice, soldOn } = matchHoldings(holdings, kind, e, claimed);
    const costPrice = refPrice ?? e.exitPrice ?? closeOn(prices.series[e.ticker], e.date);
    const shares = 100 * e.contracts;
    const endDate = soldOn && soldOn < prices.asOf ? soldOn : prices.asOf;
    const points = costPrice
      ? samplePoints(prices, grid, { ticker: e.ticker, date: e.date, endDate, costPrice, shares })
      : [];
    const last = points.at(-1);
    if (!(costPrice && last)) {
      missing.push(e.ticker);
      continue;
    }
    const id = `${kind}:${e.key}`;
    const endClose = closeOn(prices.series[e.ticker], endDate);
    const refPct = refPrice && endClose ? (endClose / refPrice - 1) * 100 : null;
    lots.push({
      id,
      kind,
      ...e,
      costPrice,
      shares,
      capital: costPrice * shares,
      endDate,
      endedByCall: endDate === soldOn,
      refPrice,
      refPct,
      points,
      last,
    });
  }
  return { lots, missing };
}

/**
 * Total $ gain of the lots vs the same capital in the S&P 500 on the same dates.
 * @param {Lot[]} lots
 * @returns {LotSummary | null}
 */
export function summarize(lots) {
  if (!lots.length) return null;
  const sum = (/** @type {(l: Lot) => number} */ pick) => lots.reduce((s, l) => s + pick(l), 0);
  const stock = sum((l) => l.last.stock);
  const spx = sum((l) => l.last.spx);
  return {
    stock,
    spx,
    excess: stock - spx,
    capital: sum((l) => l.capital),
    atStrike: sum((l) => l.atStrike),
    fromFidelity: lots.every((l) => l.refPrice !== null),
  };
}

export const TOTAL = 'total';

/**
 * Lot's value on `t`: its last point on or before `t` (so a sold lot keeps its
 * final gain), or null before the lot started.
 * @param {Lot} lot
 * @param {number} t
 * @returns {LotPoint | null}
 */
function valueOn(lot, t) {
  let found = null;
  for (const p of lot.points) {
    if (p.t > t) break;
    found = p;
  }
  return found;
}

/**
 * Amount added to both total keys at every row, on its own dates (e.g. premium
 * kept on covered calls that were never called away).
 * @typedef {{ times: number[], at: (t: number) => number }} Baseline
 */

/** @type {Baseline} */
const NO_BASELINE = { times: [], at: () => 0 };

/**
 * One row per sampled date for recharts: `{ t, [lot.id]: stock $, [`${lot.id}|spx`]: S&P $,
 * total, 'total|spx' }`. A lot's own keys only cover its holding window; the
 * total adds up every lot started by then, plus the baseline.
 * @param {Lot[]} lots
 * @param {Baseline} [baseline]
 * @returns {Array<Record<string, number>>}
 */
export function chartRows(lots, baseline = NO_BASELINE) {
  /** @type {Map<number, Record<string, number>>} */
  const rows = new Map(baseline.times.map((t) => [t, { t }]));
  for (const lot of lots) {
    for (const p of lot.points) {
      const row = rows.get(p.t) ?? { t: p.t };
      row[lot.id] = p.stock;
      row[`${lot.id}|spx`] = p.spx;
      rows.set(p.t, row);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  for (const row of sorted) {
    const values = lots.map((l) => valueOn(l, row.t ?? 0)).filter((v) => v !== null);
    const base = baseline.at(row.t ?? 0);
    row[TOTAL] = base + values.reduce((s, v) => s + v.stock, 0);
    row[`${TOTAL}|spx`] = base + values.reduce((s, v) => s + v.spx, 0);
  }
  return sorted;
}

/**
 * @typedef {{ premiumKept: number, upsideGivenUp: number, net: number, openPremium: number, calls: number, first: string, last: string }} CallsSummary
 *   premiumKept: net premium on every covered call that's done (closed/expired
 *   net of buybacks, plus called-away premium); upsideGivenUp: (price − strike)
 *   × shares on called-away lots today; openPremium: premium on open calls.
 */

/**
 * Covered calls judged on their own terms: premium collected vs upside given
 * up. Each called-away lot becomes a line of its net (premium − (price −
 * strike) × shares) with the premium as its dashed reference; the total adds
 * the premium kept on every other finished covered call as of each date.
 * @param {TradeLike[]} trades
 * @param {Lot[]} called lots from buildLots(..., 'called')
 * @param {string} asOf
 * @returns {{ lots: Lot[], summary: CallsSummary | null, baseline: Baseline }}
 */
export function coveredCalls(trades, called, asOf) {
  const lots = called.map((lot) => {
    const premium = lot.premium ?? 0;
    const strike = lot.strikes[0] ?? 0;
    // lot.points measure the shares vs costPrice; shift to vs the strike.
    const net = (/** @type {LotPoint} */ p) =>
      premium - (p.stock + (lot.costPrice - strike) * lot.shares);
    const points = lot.points.map((p) => ({ ...p, stock: net(p), spx: premium }));
    return { ...lot, points, last: points.at(-1) ?? lot.last };
  });
  const cc = trades.filter((t) => t.type === 'Covered Call');
  const done = cc
    .filter(
      (t) => (t.status === 'CLOSED' || t.status === 'EXPIRED') && typeof t.gainLoss === 'number',
    )
    .map((t) => ({ date: tradeDateToIso(t.closedOn) ?? asOf, amount: t.gainLoss ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!(done.length || lots.length)) return { lots, summary: null, baseline: NO_BASELINE };
  const lotPremium = lots.reduce((s, l) => s + (l.premium ?? 0), 0);
  const premiumKept = done.reduce((s, d) => s + d.amount, 0) + lotPremium;
  const net = lots.reduce((s, l) => s + l.last.stock, 0) + premiumKept - lotPremium;
  const first = [done[0]?.date, lots[0]?.date].filter((d) => d !== undefined).sort()[0] ?? asOf;
  const at = (/** @type {number} */ t) =>
    done.reduce((s, d) => (toMs(d.date) <= t ? s + d.amount : s), 0);
  const times = [...new Set([...weeklyGrid(first, asOf), asOf, ...done.map((d) => d.date)])].map(
    toMs,
  );
  return {
    lots,
    summary: {
      premiumKept,
      upsideGivenUp: premiumKept - net,
      net,
      openPremium: cc
        .filter((t) => t.status === 'IN PLAY')
        .reduce((s, t) => s + (t.premium ?? 0), 0),
      calls: done.length + lots.length,
      first,
      last:
        [done.at(-1)?.date, lots.at(-1)?.date]
          .filter((d) => d !== undefined)
          .sort()
          .at(-1) ?? asOf,
    },
    baseline: { times, at },
  };
}
