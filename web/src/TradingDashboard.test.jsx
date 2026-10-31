// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import TradingDashboard from './TradingDashboard.jsx';

// recharts' ResponsiveContainer uses ResizeObserver, which jsdom doesn't provide.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      /* no-op */
    }
    unobserve() {
      /* no-op */
    }
    disconnect() {
      /* no-op */
    }
  };
});

// A small fixture spanning both strategies and every status/branch the
// component keys off: in-play (with risk fields), closed win, assigned loss.
const TRADES = [
  {
    acquired: 'Jun 1, 26',
    expires: 'Aug 21, 26',
    status: 'IN PLAY',
    ticker: 'MSFT',
    contracts: 1,
    type: 'Short Put',
    premium: 683.31,
    strike: 395,
    price: 381.35,
    buffer: -3.58,
    riskLevel: 39500,
    riskCategory: 'ITM',
    duration: 81,
    estYield: 7.8,
    closedOn: null,
    gainLoss: null,
    capital: null,
    realYield: null,
  },
  {
    acquired: 'Jun 4, 26',
    expires: 'Aug 21, 26',
    status: 'IN PLAY',
    ticker: 'UBER',
    contracts: 2,
    type: 'Covered Call',
    premium: 208.65,
    strike: 90,
    price: 68.55,
    buffer: 31.29,
    riskLevel: null,
    riskCategory: 'Very Safe',
    duration: 78,
    estYield: null,
    closedOn: null,
    gainLoss: null,
    capital: null,
    realYield: null,
  },
  {
    acquired: 'Dec 16, 25',
    expires: 'Jan 16, 26',
    status: 'CLOSED',
    ticker: 'JPM',
    contracts: 2,
    type: 'Short Put',
    premium: null,
    strike: 280,
    price: null,
    buffer: null,
    riskLevel: null,
    riskCategory: null,
    duration: 31,
    estYield: null,
    closedOn: 'Jan 13, 26',
    gainLoss: 266.62,
    capital: 56000,
    realYield: 6.21,
  },
  {
    acquired: 'Dec 16, 25',
    expires: 'Feb 20, 26',
    status: 'CLOSED',
    ticker: 'GOOGL',
    contracts: 1,
    type: 'Covered Call',
    premium: null,
    strike: 365,
    price: null,
    buffer: null,
    riskLevel: null,
    riskCategory: null,
    duration: 66,
    estYield: null,
    closedOn: 'Feb 11, 26',
    gainLoss: 301.32,
    capital: null,
    realYield: null,
  },
  {
    acquired: 'Nov 17, 25',
    expires: 'Feb 20, 26',
    status: 'ASSIGNED',
    ticker: 'AMZN',
    contracts: 1,
    type: 'Short Put',
    premium: null,
    strike: 435,
    price: null,
    buffer: null,
    riskLevel: null,
    riskCategory: null,
    duration: 95,
    estYield: null,
    closedOn: 'Feb 20, 26',
    gainLoss: -3201.67,
    capital: 43500,
    realYield: null,
  },
];

describe('TradingDashboard', () => {
  it('lays out Key Metrics as six cards in order', () => {
    const { container } = render(<TradingDashboard tradesData={TRADES} />);
    const text = container.textContent;
    const keyMetrics = text.slice(text.indexOf('Key Metrics'), text.indexOf('Premium, Losses'));
    const labels = [
      'Win Rate',
      'Realized Gains',
      'Realized Losses',
      'Short Put Yield',
      'In Play',
      'Notional Risk',
    ];
    const positions = labels.map((l) => keyMetrics.indexOf(l));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // Total Trades moved into Win Rate's sublabel; it now only appears in Premium, Losses & Upside.
    expect(keyMetrics).not.toContain('Total Trades');
  });

  it('folds trade counts into the Win Rate card', () => {
    const { container } = render(<TradingDashboard tradesData={TRADES} />);
    expect(container.textContent).toContain(
      'Win Rate66.7%5 trades · 3 closed · 2 won · 1 lost · 2 in play',
    );
  });

  it('mounts with mixed trade data and renders content without throwing', () => {
    const { container } = render(<TradingDashboard tradesData={TRADES} />);
    // Stable UI chrome renders...
    expect(container.textContent).toContain('Overview');
    expect(container.textContent).toContain('Win Rate');
    // Overview is split into sections.
    for (const section of ['Key Metrics', 'Equity & Exposure', 'Winners & Losers']) {
      expect(container.textContent).toContain(section);
    }
    // ...and fixture data flows through (GOOGL is a closed trade shown on Overview).
    expect(container.textContent).toContain('GOOGL');
  });
});

describe('TradingDashboard stats and sections', () => {
  it('shows trade counts and gain/loss distribution on the overview cards', () => {
    const closedTrade = (ticker, gainLoss) => ({ ...TRADES[2], ticker, gainLoss });
    // Wins: 266.62, 301.32, 1000 · Losses: -3201.67, -98.33, -200
    const trades = [
      ...TRADES,
      closedTrade('AAPL', 1000),
      closedTrade('NVDA', -98.33),
      closedTrade('META', -200),
    ];
    const { container } = render(<TradingDashboard tradesData={trades} />);
    const text = container.textContent;
    expect(text).toContain('6 closed · 3 won · 3 lost · 2 in play');
    expect(text).toContain('Avg $522.65 · Median $301.32 · Min $266.62 · Max $1,000.00');
    expect(text).toContain('Avg -$1,166.67 · Median -$200.00 · Min -$98.33 · Max -$3,201.67');
  });
});

describe('TradingDashboard Premium, Losses & Upside', () => {
  it('shows premium, buybacks and assignments in Premium, Losses & Upside', () => {
    // JPM closed via =(400)-(133.38); GOOGL closed with no formula (premium unknown).
    const closedKnown = { ...TRADES[2], premiumCollected: 400, closeCost: 133.38 };
    // AMZN 435P assigned at 397.85 for 513.33 premium; VEEV 250C called at 260.21.
    const assigned = { ...TRADES[4], exitPrice: 397.85, premiumCollected: 513.33 };
    const called = {
      ...TRADES[3],
      status: 'CALLED',
      ticker: 'VEEV',
      strike: 250,
      gainLoss: -703.66,
      exitPrice: 260.21,
      premiumCollected: 317.34,
    };
    // Expired via =(100)-(0): its premium must count once, not as gain + formula.
    const expired = {
      ...TRADES[2],
      status: 'EXPIRED',
      gainLoss: 100,
      premiumCollected: 100,
      closeCost: 0,
    };
    const trades = [TRADES[0], TRADES[1], closedKnown, TRADES[3], assigned, called, expired];
    const { container } = render(<TradingDashboard tradesData={trades} />);
    const text = container.textContent;
    expect(text).toContain('Premium, Losses & Upside');
    // Row 1: in-play 891.96 + formula premiums 400 + 513.33 + 317.34 + 100.
    expect(text).toContain('$2,222.63In play $891.96 · excl. 1 closed w/o premium');
    expect(text).toContain(
      'Cash Used to Close$133.38Buybacks on closed trades · expired $0 · excl. 1 closed w/o premium',
    );
    // Row 2: assigned puts.
    expect(text).toContain('Puts Assigned1 contract1 trade · 1 ticker');
    expect(text).toContain('Capital Deployed$43,500');
    expect(text).toContain(
      'Puts Paper Loss (excl. premium)-$3,715.00-$3,201.67 incl. premium · at assignment price',
    );
    // Row 3: called calls.
    expect(text).toContain('Calls Assigned1 contract1 trade · 1 ticker');
    expect(text).toContain('Capital Received$25,000');
    expect(text).toContain('Upside Given Away$1,021.00');
  });

  it('drops the missing-premium note once every closed trade has a formula', () => {
    const trades = TRADES.map((t) =>
      t.status === 'CLOSED' ? { ...t, premiumCollected: t.gainLoss + 10, closeCost: 10 } : t,
    );
    const { container } = render(<TradingDashboard tradesData={trades} />);
    expect(container.textContent).toContain(
      'Cash Used to Close$20.00Buybacks on closed trades · expired $0',
    );
    expect(container.textContent).not.toContain('w/o premium');
  });
});

describe('TradingDashboard In Play sections', () => {
  it('splits the In Play Analytics tab into sections', () => {
    const { container } = render(<TradingDashboard tradesData={TRADES} />);
    fireEvent.click(within(container).getByRole('button', { name: 'In Play Analytics' }));
    for (const section of ['At Risk', 'Expiring Soon', 'Positions & Premium', 'Notional Risk']) {
      expect(container.textContent).toContain(section);
    }
  });

  it('renders an empty state without crashing on no trades', () => {
    const { container } = render(<TradingDashboard tradesData={[]} />);
    expect(container.textContent.length).toBeGreaterThan(0);
  });
});

// JPM/GOOGL closed via formula, AMZN 435P assigned at 397.85, VEEV 250C called at 260.21.
const reconciled = [
  TRADES[0],
  TRADES[1],
  { ...TRADES[2], premiumCollected: 400, closeCost: 133.38 },
  { ...TRADES[3], premiumCollected: 311.32, closeCost: 10 },
  { ...TRADES[4], exitPrice: 397.85, premiumCollected: 513.33 },
  {
    ...TRADES[3],
    status: 'CALLED',
    ticker: 'VEEV',
    strike: 250,
    gainLoss: -703.66,
    exitPrice: 260.21,
    premiumCollected: 317.34,
  },
];

describe('TradingDashboard P&L Reconciliation', () => {
  it('walks premium down to Net Realized P&L', () => {
    const { container } = render(<TradingDashboard tradesData={reconciled} />);
    const text = container.textContent;
    expect(text).toContain('P&L Reconciliation');
    // 1541.99 finished premium − 143.38 buybacks − 3715 paper loss − 1021 upside = −3337.39
    expect(text).toContain('= Premium on finished trades$1,541.99');
    expect(text).toContain('− Cash Used to Close · buybacks-$143.38');
    expect(text).toContain(
      '− Puts Paper Loss (excl. premium) · assigned at below strike-$3,715.00',
    );
    expect(text).toContain('− Upside Given Away · calls called away-$1,021.00');
    expect(text).toContain('= Net Realized P&L-$3,337.39');
    expect(text).not.toContain('Unreconciled');
  });

  it('walks premium and stock capital down to Net Cash Flow', () => {
    const { container } = render(<TradingDashboard tradesData={reconciled} />);
    const text = container.textContent;
    // 2433.95 premium − 143.38 buybacks − 43500 assigned + 25000 called = −16209.43
    expect(text).toContain('+ Premium Collected · incl. in play$2,433.95');
    expect(text).toContain('− Capital Deployed · shares bought on assigned puts-$43,500.00');
    expect(text).toContain('+ Capital Received · shares sold on called calls$25,000.00');
    expect(text).toContain('= Net Cash Flow-$16,209.43');
  });

  it('handles an assigned put typed as a plain number (no formula) without NaN', () => {
    // AMZN 435P without exitPrice/premiumCollected: its −3201.67 can't be split, so it's unreconciled.
    const plain = reconciled.map((t, i) => (i === 4 ? TRADES[4] : t));
    const { container } = render(<TradingDashboard tradesData={plain} />);
    const text = container.textContent;
    expect(text).not.toContain('NaN');
    expect(text).toContain('Puts Paper Loss (excl. premium)$0.00$0.00 incl. premium');
    expect(text).toContain('Capital Deployed$43,500');
    // finished premium 1028.66 − 143.38 − 0 − 1021 = −135.72; realized −3337.39 ⇒ gap −3201.67
    expect(text).toContain('± Unreconciled · closed trades without a premium formula-$3,201.67');
    // A subtracting row keeps its minus sign even when its amount is $0.
    expect(text).toContain('− Puts Paper Loss (excl. premium) · assigned at below strike$0.00');
  });

  it('flags the gap left by closed trades without a premium formula', () => {
    const partial = reconciled.map((t, i) => (i === 3 ? TRADES[3] : t));
    const { container } = render(<TradingDashboard tradesData={partial} />);
    expect(container.textContent).toContain(
      '± Unreconciled · closed trades without a premium formula+$301.32',
    );
  });
});

describe('TradingDashboard P&L Analytics covered calls', () => {
  it('shows each closed call’s status and counts called-away calls', () => {
    const calledCall = {
      ...TRADES[3],
      status: 'CALLED',
      ticker: 'VEEV',
      strike: 250,
      gainLoss: -703.66,
    };
    const { container } = render(<TradingDashboard tradesData={[...TRADES, calledCall]} />);
    fireEvent.click(within(container).getByRole('button', { name: 'P&L Analytics' }));
    const text = container.textContent;
    expect(text).toContain('1 called away (shares sold at strike) · 1 rolled, closed or expired.');
    // Row cells: ticker, shares, strike, status.
    expect(text).toContain(['VEEV 1×', '100', '$250', 'CALLED'].join(''));
    expect(text).toContain(['GOOGL 1×', '100', '$365', 'CLOSED'].join(''));
    expect(text).not.toContain('no underlying shares sold');
  });

  it('lists called-away calls in their own table with totals', () => {
    const veev = {
      ...TRADES[3],
      status: 'CALLED',
      ticker: 'VEEV',
      strike: 250,
      closedOn: 'Sep 18, 26',
    };
    const called = [
      { ...veev, gainLoss: -703.66, exitPrice: 260.21, premiumCollected: 317.34 },
      { ...veev, strike: 260, gainLoss: 218.34, exitPrice: 260.21, premiumCollected: 239.34 },
    ];
    const { container } = render(<TradingDashboard tradesData={[...TRADES, ...called]} />);
    fireEvent.click(within(container).getByRole('button', { name: 'P&L Analytics' }));
    const text = container.textContent;
    expect(text).toContain('Called Away (2)');
    // Row: shares, strike, price at call, dates, premium, capital received, upside, gain/loss.
    expect(text).toContain(
      ['VEEV 1×', '100', '$250', '$260.21', 'Dec 16, 25', 'Sep 18, 26'].join(''),
    );
    expect(text).toContain(['$317.34', '$25,000.00', '$1,021.00', '-$703.66'].join(''));
    // 260C called at 260.21: $21 of upside.
    expect(text).toContain(['$239.34', '$26,000.00', '$21.00', '+$218.34'].join(''));
    expect(text).toContain(['Total', '$556.68', '$51,000.00', '$1,042.00', '-$485.32'].join(''));
  });

  it('shows an empty state when no calls were called away', () => {
    const { container } = render(<TradingDashboard tradesData={TRADES} />);
    fireEvent.click(within(container).getByRole('button', { name: 'P&L Analytics' }));
    expect(container.textContent).toContain('No covered calls have been called away.');
  });
});

describe('TradingDashboard short put yield', () => {
  // JPM +$266.62 on $56k over 28 days; AMZN assigned −$3,201.67 on $43.5k over 95 days.
  it('shows capital-days and capital-weighted yields, assigned puts included', () => {
    const { container } = render(<TradingDashboard tradesData={TRADES} />);
    const text = container.textContent;
    // Capital-days: (266.62 − 3201.67) ÷ (56000 × 28 + 43500 × 95) × 365 = −18.79%
    // Capital-weighted: (6.21% × 56000 − 28.28% × 43500) ÷ 99500 = −8.87%
    expect(text).toContain(
      'Short Put Yield-18.79%Annualized capital-days · -8.87% capital-weighted · 2 closed puts incl. assigned',
    );
    expect(text).not.toContain('In Play8');
  });

  it('skips closed puts with a missing date instead of corrupting the yield', () => {
    // An undated closed put can't be annualized; the result must equal the fixture-only yield.
    const undated = { ...TRADES[2], ticker: 'NFLX', closedOn: null, gainLoss: 99999 };
    const { container } = render(<TradingDashboard tradesData={[...TRADES, undated]} />);
    const text = container.textContent;
    expect(text).toContain('Short Put Yield-18.79%');
    expect(text).toContain('2 closed puts incl. assigned');
    expect(text).not.toContain('NaN');
  });

  it('shows a dash when there are no closed puts', () => {
    const { container } = render(<TradingDashboard tradesData={[TRADES[1]]} />);
    expect(container.textContent).toContain('Short Put Yield—');
  });
});

describe('TradingDashboard P&L Analytics put yields', () => {
  it('shows the same capital-days and capital-weighted yields in the footer', () => {
    const { container } = render(<TradingDashboard tradesData={TRADES} />);
    fireEvent.click(within(container).getByRole('button', { name: 'P&L Analytics' }));
    // JPM +6.21% on $56k (28 days), AMZN −28.28% on $43.5k (95 days):
    // Same figures as the Key Metrics cards (the simple mean would be −11.04%).
    expect(container.textContent).toContain(
      'Annualized -18.79% capital-days · -8.87% capital-weighted · Total gain',
    );
  });
});
