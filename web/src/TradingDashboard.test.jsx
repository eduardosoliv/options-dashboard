// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import TradingDashboard from './TradingDashboard.jsx';

// recharts' ResponsiveContainer uses ResizeObserver, which jsdom doesn't provide.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
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
    // ...and fixture data flows through (GOOGL is a closed trade shown on Overview).
    expect(container.textContent).toContain('GOOGL');
  });

  it('renders an empty state without crashing on no trades', () => {
    const { container } = render(<TradingDashboard tradesData={[]} />);
    expect(container.textContent.length).toBeGreaterThan(0);
  });
});
