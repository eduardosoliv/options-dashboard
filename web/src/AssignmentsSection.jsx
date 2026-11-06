import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { buildLots, chartRows, coveredCalls, shortDate, summarize, TOTAL } from './assignments.js';

/**
 * @typedef {import('./assignments.js').Lot} Lot
 * @typedef {import('./assignments.js').TradeLike} TradeLike
 * @typedef {import('./data.js').Assignments} Assignments
 * @typedef {import('./assignments.js').LotSummary} LotSummary
 * @typedef {import('./assignments.js').CallsSummary} CallsSummary
 */

// Categorical slots (dataviz reference palette, dark steps), validated against
// the card surface #111113: all checks pass. Assigned in fixed order by ticker.
const SERIES = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
const SPX_GRAY = '#71717a';
// The total isn't a ticker, so it gets the neutral ink rather than a series hue.
const TOTAL_COLOR = '#e4e4e7';

/** @param {number} n */
export const fmtPct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
/** @param {number} n */
export const fmtUsd = (n) =>
  `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
/** @param {number} n */
export const fmtUsdAxis = (n) => {
  const k = Math.abs(n) / 1000;
  return `${n < 0 ? '−' : ''}$${k >= 10 || k === Math.round(k) ? k.toFixed(0) : k.toFixed(1)}k`;
};
/** @param {number} n */
const usd = (n) => `$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
/** @param {number} n strike: '$80', '$52.50' */
export const fmtStrike = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
/** @param {number} t epoch ms */
const tToShort = (t) => shortDate(new Date(t).toISOString().slice(0, 10));

/**
 * Color follows the ticker, so the same stock matches in both charts.
 * @param {Lot[]} lots
 * @returns {Map<string, string>}
 */
export function tickerColors(lots) {
  /** @type {Map<string, string>} */
  const colors = new Map();
  for (const lot of lots) {
    if (!colors.has(lot.ticker))
      colors.set(lot.ticker, SERIES[colors.size % SERIES.length] ?? SPX_GRAY);
  }
  return colors;
}

/**
 * One sentence on the assigned total: the gap to the S&P 500 and, with
 * Fidelity lots, where the capital came from.
 * @param {LotSummary} summary
 */
export function totalSentence(summary) {
  const gap = `${usd(summary.excess)} ${summary.excess >= 0 ? 'ahead of' : 'behind'} the S&P 500`;
  const premium = summary.capital - summary.atStrike;
  const breakdown = summary.fromFidelity
    ? ` = ${usd(summary.atStrike)} deployed − ${usd(premium)} premium`
    : '';
  return `Total: ${gap}; ${usd(summary.capital)} basis${breakdown}.`;
}

/**
 * One sentence on covered calls overall.
 * @param {CallsSummary} s
 */
export const callsSentence = (s) =>
  `Covered calls: ${usd(s.premiumKept)} premium kept − ${usd(s.upsideGivenUp)} upside given up = ${fmtUsd(s.net)}; open calls carry ${usd(s.openPremium)} premium not yet earned.`;

/**
 * Green for a gain, red for a loss.
 * @param {number} n
 */
export const toneClass = (n) => (n >= 0 ? 'text-emerald-400' : 'text-rose-400');

/**
 * @typedef {{ label: string, amount: number, pct: number | null, tone: string, lineBefore?: boolean }} ChipRow
 * @typedef {{
 *   id: string, color: string, title: string, strike: string | null,
 *   refLabel: string, refValue: string, date: string, sold: string | null, rows: ChipRow[],
 * }} ChipData
 */

/**
 * One row of a box: a label, the $ amount and (optionally) a %, laid out on the
 * box's shared 3-column grid so amounts line up.
 * @param {{ row: ChipRow }} props
 */
function ChipFigure({ row }) {
  return (
    <>
      {row.lineBefore && <div className="col-span-3 border-t border-zinc-800" />}
      <span className="text-[10px] uppercase tracking-wider whitespace-nowrap text-zinc-500">
        {row.label}
      </span>
      <span className={`text-base font-semibold text-right num ${row.tone}`}>
        {fmtUsd(row.amount)}
      </span>
      <span className={`text-base text-right num ${row.tone}`}>
        {row.pct === null ? '' : fmtPct(row.pct)}
      </span>
    </>
  );
}

/**
 * A box in the grid (a lot or the total): identity, reference and date on top,
 * then its rows.
 * @param {{ chip: ChipData, active: boolean, onToggle: (id: string) => void }} props
 */
function Chip({ chip, active, onToggle }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onToggle(chip.id)}
      className={`text-left rounded-lg border p-4 font-mono transition-colors ${active ? 'border-zinc-400 bg-zinc-800/60' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'}`}
    >
      {/* One shared baseline: title, reference and date line up whatever their size. */}
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className="inline-block w-3 h-[3px] rounded self-center"
          style={{ background: chip.color }}
        />
        <span className="text-sm font-semibold text-zinc-100 num">
          {chip.title}
          {chip.strike && ` ${chip.strike}`}
        </span>
        <span className="text-xs text-zinc-500 num">
          {chip.refLabel} <span className="text-zinc-300">{chip.refValue}</span>
        </span>
        <span className="ml-auto text-right text-xs leading-tight text-zinc-500">
          <span className="block">{chip.date}</span>
          {chip.sold && <span className="block">sold {chip.sold}</span>}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 gap-y-2">
        {chip.rows.map((row) => (
          <ChipFigure key={row.label} row={row} />
        ))}
      </div>
    </button>
  );
}

/** @param {Lot} lot */
const lotStrike = (lot) => (lot.strikes.length ? lot.strikes.map(fmtStrike).join('/') : null);

/**
 * @param {string} first ISO
 * @param {string} last ISO
 */
const dateRange = (first, last) =>
  first === last ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`;

/**
 * The shares' row (named by ticker) and the same dollars in the S&P 500.
 * @param {string} label
 * @param {number} stock
 * @param {number} spx
 * @param {number} capital
 * @returns {ChipRow[]}
 */
const vsSpxRows = (label, stock, spx, capital) => [
  { label, amount: stock, pct: (stock / capital) * 100, tone: toneClass(stock) },
  {
    label: 'S&P 500',
    amount: spx,
    pct: (spx / capital) * 100,
    tone: 'text-zinc-300',
    lineBefore: true,
  },
];

/**
 * Premium, upside given up and their net for covered calls.
 * @param {number} premium
 * @param {number} net
 * @returns {ChipRow[]}
 */
const callRows = (premium, net) => [
  { label: 'Premium', amount: premium, pct: null, tone: toneClass(premium) },
  { label: 'Upside given up', amount: net - premium, pct: null, tone: toneClass(net - premium) },
  { label: 'Net', amount: net, pct: null, tone: toneClass(net), lineBefore: true },
];

/**
 * Assigned card: Total + one box per lot, chart rows, and the note sentence.
 * @param {Lot[]} lots
 * @param {Map<string, string>} colors
 */
function assignedCard(lots, colors) {
  const summary = summarize(lots);
  const lotChips = lots.map(
    (lot) =>
      /** @type {ChipData} */ ({
        id: lot.id,
        color: colors.get(lot.ticker) ?? SPX_GRAY,
        title: `${lot.ticker}×${lot.contracts}`,
        strike: lotStrike(lot),
        refLabel: lot.refPrice === null ? 'from' : 'basis',
        refValue: `$${lot.costPrice.toFixed(2)}`,
        date: lot.label,
        sold: lot.endedByCall ? shortDate(lot.endDate) : null,
        rows: vsSpxRows(lot.ticker, lot.last.stock, lot.last.spx, lot.capital),
      }),
  );
  if (!summary) return { chips: lotChips, rows: chartRows(lots), sentence: '' };
  /** @type {ChipData} */
  const total = {
    id: TOTAL,
    color: TOTAL_COLOR,
    title: 'Total',
    strike: null,
    refLabel: 'basis',
    refValue: usd(summary.capital),
    date: dateRange(lots[0]?.date ?? '', lots.at(-1)?.date ?? ''),
    sold: null,
    rows: vsSpxRows('All lots', summary.stock, summary.spx, summary.capital),
  };
  return { chips: [total, ...lotChips], rows: chartRows(lots), sentence: totalSentence(summary) };
}

/**
 * Covered-calls card: "All covered calls" + one box per called-away lot.
 * @param {TradeLike[]} trades
 * @param {Lot[]} called
 * @param {Map<string, string>} colors
 * @param {string} asOf
 */
function calledCard(trades, called, colors, asOf) {
  const { lots, summary, baseline } = coveredCalls(trades, called, asOf);
  const lotChips = lots.map(
    (lot) =>
      /** @type {ChipData} */ ({
        id: lot.id,
        color: colors.get(lot.ticker) ?? SPX_GRAY,
        title: `${lot.ticker}×${lot.contracts}`,
        strike: lotStrike(lot),
        refLabel: lot.refPrice === null ? 'from' : 'sold at',
        refValue: `$${lot.costPrice.toFixed(2)}`,
        date: lot.label,
        sold: null,
        rows: callRows(lot.last.stock, lot.last.stock - lot.last.spx),
      }),
  );
  const rows = chartRows(lots, baseline);
  if (!summary) return { lots, chips: lotChips, rows, sentence: '' };
  /** @type {ChipData} */
  const total = {
    id: TOTAL,
    color: TOTAL_COLOR,
    title: 'All covered calls',
    strike: null,
    refLabel: `${summary.calls} done`,
    refValue: '',
    date: dateRange(summary.first, summary.last),
    sold: null,
    rows: callRows(summary.premiumKept, summary.net),
  };
  return { lots, chips: [total, ...lotChips], rows, sentence: callsSentence(summary) };
}

/**
 * @param {{ chips: ChipData[], rows: Array<Record<string, number>>, shown: Set<string>, t: number, refName: string }} props
 */
function TooltipBody({ chips, rows, shown, t, refName }) {
  const row = rows.find((r) => r.t === t);
  if (!row) return null;
  const listed = chips.filter((c) => shown.has(c.id) && row[c.id] !== undefined);
  if (!listed.length) return null;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 font-mono text-xs">
      <div className="mb-1 font-semibold text-zinc-100">{tToShort(t)}</div>
      {listed.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-zinc-300">
          <span className="inline-block w-2.5 h-[3px] rounded" style={{ background: c.color }} />
          <span className="text-zinc-100">
            {c.title}
            {c.strike && ` ${c.strike}`}
          </span>
          <span className="num ml-auto pl-3">{fmtUsd(row[c.id] ?? 0)}</span>
          <span className="num text-zinc-500">
            {refName} {fmtUsd(row[`${c.id}|spx`] ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Ring at the end of each lot's line: filled while held, hollow once sold.
 * `marked` lots (a second lot sharing its ticker's color) also get small dots
 * on every point, so two same-colored lines stay distinguishable.
 * @param {Lot} lot
 * @param {string} color
 * @param {boolean} marked
 */
const endDot =
  (lot, color, marked) =>
  /** @param {{ cx?: number, cy?: number, payload?: Record<string, number> }} p */
  (p) => {
    const key = `${lot.id}-${p.payload?.t}`;
    if (p.cx === undefined || p.cy === undefined) return <g key={key} />;
    if (p.payload?.t === lot.last.t) {
      return (
        <circle
          key={key}
          cx={p.cx}
          cy={p.cy}
          r={4}
          fill={lot.endedByCall ? '#111113' : color}
          stroke={color}
          strokeWidth={2}
        />
      );
    }
    return marked ? <circle key={key} cx={p.cx} cy={p.cy} r={2.5} fill={color} /> : <g key={key} />;
  };

/**
 * Solid line (result) and its dashed reference line (S&P 500 or upside given up),
 * drawn only for selected series so the chart stays readable.
 * @param {{ id: string, color: string, shown: Set<string>, isTotal: boolean, dot: ReturnType<typeof endDot> | false }} props
 */
function seriesLines({ id, color, shown, isTotal, dot }) {
  if (!shown.has(id)) return [];
  return [
    <Line
      key={`${id}|spx`}
      dataKey={`${id}|spx`}
      stroke={color}
      strokeOpacity={0.8}
      strokeWidth={1.5}
      strokeDasharray="4 4"
      dot={false}
      activeDot={false}
      connectNulls={true}
      isAnimationActive={false}
    />,
    <Line
      key={id}
      dataKey={id}
      stroke={color}
      strokeWidth={isTotal ? 2.75 : 2.25}
      dot={dot}
      activeDot={{ r: 4 }}
      connectNulls={true}
      isAnimationActive={false}
    />,
  ];
}

/**
 * @param {{ lots: Lot[], chips: ChipData[], rows: Array<Record<string, number>>, shown: Set<string>, refName: string }} props
 */
function LotChart({ lots, chips, rows, shown, refName }) {
  const colorOf = new Map(chips.map((c) => [c.id, c.color]));
  const usedColors = new Set();
  return (
    <div className="relative">
      {shown.size === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none text-sm font-mono text-zinc-500">
          Select a box above to show its line
        </div>
      )}
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="2 2" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            stroke="#71717a"
            fontSize={10}
            tickFormatter={tToShort}
          />
          <YAxis stroke="#71717a" fontSize={10} width={56} tickFormatter={fmtUsdAxis} />
          <ReferenceLine y={0} stroke="#52525b" />
          <Tooltip
            cursor={{ stroke: '#52525b' }}
            content={({ active, label }) =>
              active ? (
                <TooltipBody
                  chips={chips}
                  rows={rows}
                  shown={shown}
                  t={Number(label)}
                  refName={refName}
                />
              ) : null
            }
          />
          {lots.flatMap((lot) => {
            const color = colorOf.get(lot.id) ?? SPX_GRAY;
            const marked = usedColors.has(color);
            usedColors.add(color);
            return seriesLines({
              id: lot.id,
              color,
              shown,
              isTotal: false,
              dot: endDot(lot, color, marked),
            });
          })}
          {seriesLines({ id: TOTAL, color: TOTAL_COLOR, shown, isTotal: true, dot: false })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Multi-select: starts with only the total; click toggles a box in or out.
 * @returns {{ selected: Set<string>, toggle: (id: string) => void }}
 */
function useSelection() {
  const [selected, setSelected] = useState(() => new Set([TOTAL]));
  const toggle = (/** @type {string} */ id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return { selected, toggle };
}

/**
 * @param {{ title: string, eyebrow: string }} props
 */
function CardHeader({ title, eyebrow }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">{eyebrow}</div>
      <div className="font-serif text-2xl font-semibold mt-1">{title}</div>
    </div>
  );
}

/**
 * @param {{
 *   eyebrow: string, title: string, emptyText: string, refName: string, assumptions: string[],
 *   card: { chips: ChipData[], rows: Array<Record<string, number>>, sentence: string },
 *   lots: Lot[], missing: string[],
 * }} props
 */
function LotCard({ eyebrow, title, emptyText, refName, assumptions, card, lots, missing }) {
  const { selected, toggle } = useSelection();
  const missingNote = missing.length
    ? ` No price data for: ${[...new Set(missing)].join(', ')}.`
    : '';
  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6">
      <CardHeader title={title} eyebrow={eyebrow} />
      <Assumptions title={title} items={assumptions} inset={true} />
      {card.chips.length === 0 ? (
        <div className="py-10 text-center text-sm font-mono text-zinc-500">{emptyText}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
            {card.chips.map((chip) => (
              <Chip key={chip.id} chip={chip} active={selected.has(chip.id)} onToggle={toggle} />
            ))}
          </div>
          <LotChart
            lots={lots}
            chips={card.chips}
            rows={card.rows}
            shown={selected}
            refName={refName}
          />
        </>
      )}
      <div className="mt-2 text-[11px] font-mono text-zinc-500">
        {card.sentence}
        {missingNote}
      </div>
    </div>
  );
}

// What the charts assume and how their numbers are built: general first, then per chart.
export const GENERAL_ASSUMPTIONS = [
  'Dividends are not included: share and S&P 500 figures are price-only, and dividends forgone on called-away shares are not counted.',
  'Prices are daily closes, sampled weekly; the last point is the latest close.',
  'Each strike is its own lot. A second lot of the same ticker shares its color and has dots on its line.',
  'Only selected lines are drawn: click boxes to add or remove them. Total is selected by default.',
];

export const ASSIGNED_ASSUMPTIONS = [
  'Capital deployed = strike × 100 × contracts; cost basis = capital deployed − premium.',
  "A lot's gain / loss = (price − cost basis) × shares, from its assignment day. It can start below $0 when the stock was under the basis that day.",
  'S&P 500 (dashed) = the same cost basis put in the S&P 500 on the assignment day.',
  'Shares sold since end at the sale (hollow ring) and keep their final gain in the total.',
];

export const CALLS_ASSUMPTIONS = [
  'Every covered call earns premium; only called-away ones give up upside.',
  'Premium kept (solid) = all finished covered calls (closed or expired, net of buybacks) plus called-away premium. Open calls count once they finish.',
  'Upside given up (dashed) = (price now − strike) × shares on called-away lots; it moves with the stock price.',
  'Net = premium − upside given up, the gap between the lines: solid above dashed means the premium beat the upside given up.',
];

/**
 * General assumptions are their own card; a chart's sit inside its card as an
 * inset panel above the boxes.
 * @param {{ title: string, items: string[], inset?: boolean }} props
 */
function Assumptions({ title, items, inset = false }) {
  const frame = inset
    ? 'rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 mb-5'
    : 'bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6';
  return (
    <div className={frame}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-3">
        Assumptions · {title}
      </div>
      <ul className="text-xs text-zinc-400 font-mono space-y-1 leading-relaxed">
        {items.map((item) => (
          <li key={item}>· {item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Section title bar. */
function SectionHeader() {
  return (
    <div className="flex items-baseline gap-3 mb-3 border-b border-zinc-800 pb-2">
      <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 px-2 py-0.5 border border-amber-500/40 rounded">
        Section
      </span>
      <h2 className="font-serif text-xl sm:text-2xl font-semibold">
        Assigned <span style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>&amp;</span> Called
      </h2>
      <span className="text-xs font-mono text-zinc-500">
        — assigned shares vs the S&P 500; covered calls: premium vs upside given up
      </span>
    </div>
  );
}

/**
 * Both cards, built from the trades plus assignments.json.
 * @param {{ trades: TradeLike[], assignments: Assignments }} props
 */
function AssignedAndCalled({ trades, assignments }) {
  const assigned = useMemo(
    () => buildLots(trades, assignments, 'assigned', assignments),
    [trades, assignments],
  );
  const called = useMemo(
    () => buildLots(trades, assignments, 'called', assignments),
    [trades, assignments],
  );
  const colors = useMemo(
    () => tickerColors([...assigned.lots, ...called.lots]),
    [assigned, called],
  );
  const assignedView = useMemo(() => assignedCard(assigned.lots, colors), [assigned, colors]);
  const calledView = useMemo(
    () => calledCard(trades, called.lots, colors, assignments.asOf),
    [trades, called, colors, assignments],
  );
  return (
    <>
      <Assumptions title="General" items={GENERAL_ASSUMPTIONS} />
      <LotCard
        eyebrow="$ gain / loss since assignment"
        title="Assigned Shares"
        emptyText="No assigned shares yet."
        refName="S&P 500"
        assumptions={ASSIGNED_ASSUMPTIONS}
        card={assignedView}
        lots={assigned.lots}
        missing={assigned.missing}
      />
      <LotCard
        eyebrow="Premium kept vs upside given up"
        title="Covered Calls"
        emptyText="No covered calls yet."
        refName="upside given up"
        assumptions={CALLS_ASSUMPTIONS}
        card={calledView}
        lots={calledView.lots}
        missing={called.missing}
      />
    </>
  );
}

/**
 * The Assigned & Called section. `assignments` comes from assignments.json
 * (the Sheet's AssignedCalled tab); without it the section explains how to
 * set it up instead of drawing anything.
 * @param {{ trades: TradeLike[], assignments?: Assignments | null }} props
 */
export default function AssignmentsSection({ trades, assignments = null }) {
  return (
    <>
      <SectionHeader />
      {assignments ? (
        <AssignedAndCalled trades={trades} assignments={assignments} />
      ) : (
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 sm:p-6 text-sm font-mono text-zinc-500">
          No assignments.json yet. Add an AssignedCalled tab to the Sheet (broker lots +
          GOOGLEFINANCE price history) and run the fetcher to fill this section.
        </div>
      )}
    </>
  );
}
