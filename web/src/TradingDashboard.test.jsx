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

  it('splits the In Play Analytics tab into sections', () => {
    const { container } = render(<TradingDashboard tradesData={TRADES} />);
    fireEvent.click(within(container).getByRole('button', { name: /In Play Analytics/ }));
    for (const section of ['At Risk', 'Expiring Soon', 'Positions & Premium', 'Notional Risk']) {
      expect(container.textContent).toContain(section);
    }
  });

  it('renders an empty state without crashing on no trades', () => {
    const { container } = render(<TradingDashboard tradesData={[]} />);
    expect(container.textContent.length).toBeGreaterThan(0);
  });
});
