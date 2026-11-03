import { describe, expect, it } from 'vitest';
import {
  buildLots,
  chartRows,
  closeOn,
  daysBetween,
  shortDate,
  summarize,
  TOTAL,
  tradeDateToIso,
} from './assignments.js';

/** @typedef {import('./assignments.js').PriceHistory} PriceHistory */
/** @typedef {import('./assignments.js').TradeLike} TradeLike */

/**
 * Daily closes from `start`, one per calendar day.
 * @param {string} start
 * @param {number[]} closes
 * @returns {import('./assignments.js').PricePoint[]}
 */
const daily = (start, closes) =>
  closes.map((c, i) => [
    new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
    c,
  ]);

/**
 * @param {Partial<TradeLike>} over
 * @returns {TradeLike}
 */
const row = (over) => ({
  ticker: 'AAA',
  status: 'ASSIGNED',
  contracts: 1,
  strike: 100,
  closedOn: 'Jan 1, 26',
  exitPrice: 100,
  ...over,
});

// 15 days: AAA 100 → 114 (+1/day), SPX 1000 → 1070 (+5/day).
/** @type {PriceHistory} */
const PRICES = {
  asOf: '2026-01-15',
  series: {
    SPX: daily(
      '2026-01-01',
      Array.from({ length: 15 }, (_, i) => 1000 + 5 * i),
    ),
    AAA: daily(
      '2026-01-01',
      Array.from({ length: 15 }, (_, i) => 100 + i),
    ),
  },
};

describe('date helpers', () => {
  it('converts the sheet date format to ISO', () => {
    expect(tradeDateToIso('Feb 12, 26')).toBe('2026-02-12');
    expect(tradeDateToIso('Sep 1, 26')).toBe('2026-09-01');
    expect(tradeDateToIso('12/02/2026')).toBeNull();
    expect(tradeDateToIso(null)).toBeNull();
    expect(shortDate('2026-09-08')).toBe('Sep 8');
  });

  it('counts days and finds the last close on or before a date', () => {
    expect(daysBetween('2026-01-01', '2026-01-15')).toBe(14);
    const series = /** @type {import('./assignments.js').PricePoint[]} */ ([
      ['2026-01-02', 10],
      ['2026-01-05', 11],
    ]);
    expect(closeOn(series, '2026-01-01')).toBeNull();
    expect(closeOn(series, '2026-01-04')).toBe(10);
    expect(closeOn(series, '2026-01-09')).toBe(11);
    expect(closeOn(undefined, '2026-01-09')).toBeNull();
  });
});

describe('buildLots', () => {
  it('samples weekly from the assignment day to asOf vs the S&P', () => {
    const { lots, missing } = buildLots([row({})], PRICES, 'assigned');
    expect(missing).toEqual([]);
    expect(lots).toHaveLength(1);
    const [lot] = lots;
    expect(lot).toMatchObject({
      id: 'assigned:AAA:2026-01-01:100',
      ticker: 'AAA',
      label: 'Jan 1, 26',
      costPrice: 100,
      shares: 100,
      capital: 10_000,
      endDate: '2026-01-15',
      endedByCall: false,
    });
    expect(lot?.points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']);
    // 100 shares 100 → 114 = +$1,400; $10,000 in the S&P at +7% = +$700.
    expect(lot?.last.stock).toBeCloseTo(1400);
    expect(lot?.last.spx).toBeCloseTo(700);
  });

  it('measures from the market price on the event day, not the strike', () => {
    const { lots } = buildLots([row({ strike: 120, exitPrice: 105 })], PRICES, 'assigned');
    // Measured from 105 (no Fidelity basis); the day-0 close is 100 → −$500.
    expect(lots[0]?.points[0]?.stock).toBeCloseTo(-500);
  });

  it('merges same-day rows for a ticker and strike and sums contracts', () => {
    const { lots } = buildLots([row({ contracts: 5 }), row({ contracts: 5 })], PRICES, 'assigned');
    expect(lots).toHaveLength(1);
    expect(lots[0]?.contracts).toBe(10);
  });

  it('reports tickers without price data instead of drawing them', () => {
    const { lots, missing } = buildLots([row({ ticker: 'ZZZ' })], PRICES, 'assigned');
    expect(lots).toEqual([]);
    expect(missing).toEqual(['ZZZ']);
  });

  it('ignores other statuses and rows without a close date', () => {
    const trades = [row({ status: 'CLOSED' }), row({ closedOn: null })];
    expect(buildLots(trades, PRICES, 'assigned').lots).toEqual([]);
  });
});

describe('summarize and chartRows', () => {
  it('totals $ gains and capital across lots', () => {
    const lots = buildLots(
      [
        row({ contracts: 3 }),
        row({ ticker: 'AAA', closedOn: 'Jan 8, 26', exitPrice: 107, contracts: 1 }),
      ],
      PRICES,
      'assigned',
    ).lots;
    // Lot 1: 30,000 at +14% / S&P +7%. Lot 2: 10,700 at +6.54% / S&P +3.27%.
    // 300 sh 100 → 114 = $4,200 and 100 sh 107 → 114 = $700; S&P: $30,000 × 7%
    // plus $10,700 × (1070 / 1035 − 1).
    const s = summarize(lots);
    expect(s?.stock).toBeCloseTo(4900);
    expect(s?.spx).toBeCloseTo(2100 + 10_700 * (1070 / 1035 - 1));
    expect(s?.excess).toBeCloseTo((s?.stock ?? 0) - (s?.spx ?? 0));
    expect(s?.capital).toBe(40_700);
    // Strike value from the sheet (100 × 400 shares); no Fidelity lots → no premium breakdown.
    expect(s?.atStrike).toBe(40_000);
    expect(s?.fromFidelity).toBe(false);
    expect(summarize([])).toBeNull();
  });

  it('builds one row per sampled date keyed by lot id', () => {
    const { lots } = buildLots([row({})], PRICES, 'assigned');
    const rows = chartRows(lots);
    expect(rows.map((r) => r.t)).toEqual(
      ['2026-01-01', '2026-01-08', '2026-01-15'].map((d) => Date.parse(d)),
    );
    expect(rows[1]?.['assigned:AAA:2026-01-01:100']).toBeCloseTo(700);
    expect(rows[1]?.['assigned:AAA:2026-01-01:100|spx']).toBeCloseTo(350);
  });
});

describe('chartRows total line', () => {
  it('adds lots into a total on a shared weekly grid, keeping sold lots at their final gain', () => {
    /** @type {import('./assignments.js').Holdings} */
    const holdings = {
      asOf: '2026-01-15',
      held: [{ ticker: 'AAA', acquired: '2026-01-08', quantity: 100, costBasis: 10_700 }],
      sold: [
        {
          ticker: 'AAA',
          acquired: '2026-01-01',
          sold: '2026-01-09',
          quantity: 100,
          costBasis: 10_000,
          proceeds: 0,
        },
      ],
    };
    // Strikes sit above each Fidelity cost basis (cost = strike − premium).
    const trades = [
      row({ strike: 101 }),
      row({ closedOn: 'Jan 8, 26', exitPrice: 107, strike: 110 }),
    ];
    const { lots } = buildLots(trades, PRICES, 'assigned', holdings);
    const byDate = Object.fromEntries(
      chartRows(lots).map((r) => [new Date(r.t ?? 0).toISOString().slice(0, 10), r]),
    );
    // Lot 1 (100 → sold Jan 9 at 108) samples Jan 1, 8, 9; lot 2 (107 basis) Jan 8, 15.
    expect(Object.keys(byDate)).toEqual(['2026-01-01', '2026-01-08', '2026-01-09', '2026-01-15']);
    expect(byDate['2026-01-01']?.[TOTAL]).toBeCloseTo(0);
    expect(byDate['2026-01-08']?.[TOTAL]).toBeCloseTo(700 + 0);
    // Lot 2 has no Jan 9 sample, so it carries its Jan 8 value ($0).
    expect(byDate['2026-01-09']?.[TOTAL]).toBeCloseTo(800);
    // Lot 1 holds its +$800 after the sale; lot 2 is at 114 − 107 = +$700.
    expect(byDate['2026-01-15']?.[TOTAL]).toBeCloseTo(800 + 700);
    expect(byDate['2026-01-15']?.['assigned:AAA:2026-01-01:101']).toBeUndefined();
    expect(byDate['2026-01-15']?.[`${TOTAL}|spx`]).toBeCloseTo(
      10_000 * (1040 / 1000 - 1) + 10_700 * (1070 / 1035 - 1),
    );
  });
});

// Assigned Jan 1, called Jan 9.
const ASSIGNED_THEN_CALLED = [
  row({}),
  row({ status: 'CALLED', closedOn: 'Jan 9, 26', exitPrice: 108 }),
];

describe('buildLots with Fidelity holdings', () => {
  it('runs a still-held assigned lot to asOf and reports gain vs cost basis', () => {
    /** @type {import('./assignments.js').Holdings} */
    const holdings = {
      asOf: '2026-01-15',
      // Fidelity dates the lot a day off the sheet; cost = strike − premium.
      held: [{ ticker: 'AAA', acquired: '2026-01-02', quantity: 100, costBasis: 9500 }],
      sold: [],
    };
    const lot = buildLots(ASSIGNED_THEN_CALLED, PRICES, 'assigned', holdings).lots[0];
    expect(lot).toMatchObject({ endDate: '2026-01-15', endedByCall: false, refPrice: 95 });
    expect(lot?.refPct).toBeCloseTo((114 / 95 - 1) * 100);
    // $ measured from the basis, like Fidelity's total gain/loss.
    expect(lot?.last.stock).toBeCloseTo((114 - 95) * 100);
    expect(lot?.capital).toBe(9500);
  });

  it('ends an assigned lot at the sale when Fidelity shows it sold', () => {
    /** @type {import('./assignments.js').Holdings} */
    const holdings = {
      asOf: '2026-01-15',
      held: [],
      sold: [
        {
          ticker: 'AAA',
          acquired: '2026-01-01',
          sold: '2026-01-09',
          quantity: 100,
          costBasis: 9500,
          proceeds: 10_600,
        },
      ],
    };
    const assigned = buildLots(ASSIGNED_THEN_CALLED, PRICES, 'assigned', holdings).lots[0];
    expect(assigned).toMatchObject({ endDate: '2026-01-09', endedByCall: true, refPrice: 95 });
    expect(assigned?.points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-08', '2026-01-09']);
    const called = buildLots(ASSIGNED_THEN_CALLED, PRICES, 'called', holdings).lots[0];
    expect(called).toMatchObject({
      kind: 'called',
      endDate: '2026-01-15',
      endedByCall: false,
      refPrice: 106,
    });
    // Upside given up vs proceeds of 106; proceeds in the S&P from Jan 9 (1040).
    expect(called?.last.stock).toBeCloseTo((114 - 106) * 100);
    expect(called?.last.spx).toBeCloseTo(10_600 * (1070 / 1040 - 1));
    expect(called?.refPct).toBeCloseTo((114 / 106 - 1) * 100);
  });
});

describe('buildLots holdings matching', () => {
  it('averages basis over same-ticker lots and ignores lots outside the date window', () => {
    /** @type {import('./assignments.js').Holdings} */
    const holdings = {
      asOf: '2026-01-15',
      held: [
        { ticker: 'AAA', acquired: '2025-12-31', quantity: 100, costBasis: 9000 },
        { ticker: 'AAA', acquired: '2026-01-01', quantity: 100, costBasis: 9900 },
        { ticker: 'AAA', acquired: '2026-01-10', quantity: 100, costBasis: 1 },
        { ticker: 'BBB', acquired: '2026-01-01', quantity: 100, costBasis: 1 },
      ],
      sold: [],
    };
    const lot = buildLots([row({ contracts: 2 })], PRICES, 'assigned', holdings).lots[0];
    expect(lot?.refPrice).toBe(94.5);
  });

  it('leaves refPrice empty without holdings', () => {
    const lot = buildLots(ASSIGNED_THEN_CALLED, PRICES, 'assigned').lots[0];
    expect(lot).toMatchObject({
      endDate: '2026-01-15',
      endedByCall: false,
      refPrice: null,
      refPct: null,
    });
  });
});

describe('buildLots strikes', () => {
  it('splits same-day assignments by strike and matches each to its Fidelity lot', () => {
    /** @type {import('./assignments.js').Holdings} */
    const holdings = {
      asOf: '2026-01-15',
      // Cost per share = strike − premium: 28.80 → the 30 put, 24.20 → the 25 put.
      held: [
        { ticker: 'AAA', acquired: '2025-12-31', quantity: 500, costBasis: 14_400 },
        { ticker: 'AAA', acquired: '2026-01-01', quantity: 500, costBasis: 12_100 },
      ],
      sold: [],
    };
    const { lots } = buildLots(
      [row({ contracts: 5, strike: 30 }), row({ contracts: 5, strike: 25 })],
      PRICES,
      'assigned',
      holdings,
    );
    expect(lots.map((l) => [l.id, l.contracts, l.atStrike, l.refPrice])).toEqual([
      ['assigned:AAA:2026-01-01:25', 5, 12_500, 24.2],
      ['assigned:AAA:2026-01-01:30', 5, 15_000, 28.8],
    ]);
  });

  it('splits same-day calls by strike and matches each to its Fidelity sale', () => {
    const call = (/** @type {number} */ strike) =>
      row({ status: 'CALLED', closedOn: 'Jan 9, 26', strike, exitPrice: 108 });
    /** @type {import('./assignments.js').Holdings} */
    const holdings = {
      asOf: '2026-01-15',
      held: [],
      sold: [
        // Proceeds per share = strike + premium: 106.39 → the 106 call, 105.17 → the 105 call.
        {
          ticker: 'AAA',
          acquired: '2025-12-01',
          sold: '2026-01-09',
          quantity: 100,
          costBasis: 9000,
          proceeds: 10_639,
        },
        {
          ticker: 'AAA',
          acquired: '2025-11-01',
          sold: '2026-01-09',
          quantity: 100,
          costBasis: 9000,
          proceeds: 10_517,
        },
      ],
    };
    const { lots } = buildLots([call(106), call(105)], PRICES, 'called', holdings);
    expect(lots.map((l) => [l.id, l.strikes, l.refPrice])).toEqual([
      ['called:AAA:2026-01-09:105', [105], 105.17],
      ['called:AAA:2026-01-09:106', [106], 106.39],
    ]);
  });
});

describe('buildLots Fidelity matching rules', () => {
  /** @param {Partial<import('./assignments.js').Holdings>} over */
  const holdingsOf = (over) => ({ asOf: '2026-01-15', held: [], sold: [], ...over });

  it("aims for strike − the sheet's premium per share, so a no-premium lot near the strike loses", () => {
    // Strike 120 with $600 premium → expected basis 114. The 119.995 lot
    // is below the strike too, but it was bought without a premium.
    const holdings = holdingsOf({
      held: [{ ticker: 'AAA', acquired: '2026-01-01', quantity: 100, costBasis: 11_400.5 }],
      sold: [
        {
          ticker: 'AAA',
          acquired: '2026-01-03',
          sold: '2026-01-09',
          quantity: 100,
          costBasis: 11_999.5,
          proceeds: 0,
        },
      ],
    });
    const trades = [row({ strike: 120, premiumCollected: 600 })];
    const lot = buildLots(trades, PRICES, 'assigned', holdings).lots[0];
    expect(lot).toMatchObject({ refPrice: 114.005, endedByCall: false, endDate: '2026-01-15' });
  });

  it('never matches a lot on the wrong side of the strike', () => {
    // Basis 98 is above the 90 strike, so the 90 put matches the sold 89 lot.
    const holdings = holdingsOf({
      held: [{ ticker: 'AAA', acquired: '2026-01-01', quantity: 100, costBasis: 9800 }],
      sold: [
        {
          ticker: 'AAA',
          acquired: '2026-01-01',
          sold: '2026-01-09',
          quantity: 100,
          costBasis: 8900,
          proceeds: 0,
        },
      ],
    });
    const lot = buildLots([row({ strike: 90 })], PRICES, 'assigned', holdings).lots[0];
    expect(lot).toMatchObject({ refPrice: 89, endedByCall: true, endDate: '2026-01-09' });
  });

  it('uses each Fidelity lot for one event only', () => {
    // Both lots are below both strikes; the 25 put takes the closer 24.90 lot,
    // leaving 24.50 for the 30 put instead of reusing 24.90.
    const holdings = holdingsOf({
      held: [
        { ticker: 'AAA', acquired: '2026-01-01', quantity: 100, costBasis: 2450 },
        { ticker: 'AAA', acquired: '2026-01-01', quantity: 100, costBasis: 2490 },
      ],
    });
    const trades = [row({ strike: 25 }), row({ strike: 30 })];
    const { lots } = buildLots(trades, PRICES, 'assigned', holdings);
    expect(lots.map((l) => l.refPrice)).toEqual([24.9, 24.5]);
  });
});
