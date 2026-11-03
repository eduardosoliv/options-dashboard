// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import AssignmentsSection, {
  callsSentence,
  fmtPct,
  fmtStrike,
  fmtUsd,
  fmtUsdAxis,
  tickerColors,
  toneClass,
  totalSentence,
} from './AssignmentsSection.jsx';

// Unmount between tests so screen-wide queries only see the current render.
afterEach(cleanup);

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

/** @type {import('./assignments.js').PriceHistory} */
const PRICES = {
  asOf: '2026-01-15',
  sample: true,
  series: {
    SPX: [
      ['2026-01-01', 1000],
      ['2026-01-15', 1100],
    ],
    AAA: [
      ['2026-01-01', 100],
      ['2026-01-09', 108],
      ['2026-01-15', 120],
    ],
  },
};

/** @type {import('./assignments.js').Holdings} */
const HOLDINGS = {
  asOf: '2026-01-15',
  held: [],
  sold: [
    {
      ticker: 'AAA',
      acquired: '2026-01-01',
      sold: '2026-01-09',
      quantity: 200,
      costBasis: 19_000,
      proceeds: 21_200,
    },
  ],
};

const TRADES = [
  {
    ticker: 'AAA',
    status: 'ASSIGNED',
    contracts: 2,
    strike: 100,
    closedOn: 'Jan 1, 26',
    exitPrice: 100,
  },
  {
    ticker: 'AAA',
    type: 'Covered Call',
    status: 'CALLED',
    contracts: 2,
    strike: 105,
    closedOn: 'Jan 9, 26',
    exitPrice: 108,
    premiumCollected: 100,
  },
  // A covered call that expired / was bought back: premium kept, no upside lost.
  {
    ticker: 'CCC',
    type: 'Covered Call',
    status: 'CLOSED',
    contracts: 1,
    strike: 40,
    closedOn: 'Jan 5, 26',
    gainLoss: 400,
  },
  // An open covered call: premium not yet earned.
  {
    ticker: 'CCC',
    type: 'Covered Call',
    status: 'IN PLAY',
    contracts: 1,
    strike: 45,
    closedOn: null,
    premium: 250,
  },
  {
    ticker: 'BBB',
    status: 'ASSIGNED',
    contracts: 1,
    strike: 50,
    closedOn: 'Jan 2, 26',
    exitPrice: 50,
  },
];

describe('AssignmentsSection', () => {
  it('renders both cards with a chip per lot and the sample badge', () => {
    const { container, getAllByText } = render(
      <AssignmentsSection trades={TRADES} prices={PRICES} holdings={HOLDINGS} />,
    );
    const text = container.textContent;
    expect(text).toContain('Assigned & Called');
    expect(text).toContain('Assigned Shares');
    expect(text).toContain('Covered Calls');
    expect(getAllByText('Sample prices')).toHaveLength(2);
    // 200 AAA on a $95 basis, sold Jan 9 at 108 → +$2,600; S&P flat by Jan 9.
    expect(text).toContain(
      'AAA×2 $100basis $95.00Jan 1, 26sold Jan 9AAA+$2,600+13.7%S&P 500+$0+0.0%',
    );
    expect(text).toContain(
      // 200 shares, 105 strike, now 120: $3,000 upside given up against $100 premium.
      // biome-ignore lint/security/noSecrets: expected box text, not a secret
      'AAA×2 $105sold at $106.00Jan 9, 26Premium+$100Upside given up−$3,000Net−$2,900',
    );
    expect(text).toContain('No price data for: BBB.');
    expect(text).toContain(
      'Total: $2,600 ahead of the S&P 500; $19,000 basis = $20,000 deployed − $1,000 premium.',
    );
    expect(text).toContain(
      'Covered calls: $500 premium kept − $3,000 upside given up = −$2,500; open calls carry $250 premium not yet earned.',
    );
    // All covered calls: $400 kept on CCC + $100 called premium − $3,000 upside.
    expect(text).toContain(
      // biome-ignore lint/security/noSecrets: expected box text, not a secret
      'All covered calls2 done Jan 5 – Jan 9Premium+$500Upside given up−$3,000Net−$2,500AAA×2',
    );
    expect(text).toContain('Totalbasis $19,000Jan 1All lots+$2,600+13.7%S&P 500+$0+0.0%AAA×2');
  });
});

describe('AssignmentsSection interaction', () => {
  it('starts with only Total selected and lets several boxes be selected', () => {
    const { getAllByRole, getByText, queryByText } = render(
      <AssignmentsSection trades={TRADES} prices={PRICES} holdings={HOLDINGS} />,
    );
    // Assigned card: Total, then the AAA lot.
    const [total, lot] = getAllByRole('button');
    if (!(total && lot)) throw new Error('missing boxes');
    const pressed = () => [total, lot].map((b) => b.getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['true', 'false']);
    expect(queryByText('Select a box above to show its line')).toBeNull();
    fireEvent.click(lot);
    expect(pressed()).toEqual(['true', 'true']);
    fireEvent.click(total);
    expect(pressed()).toEqual(['false', 'true']);
    fireEvent.click(lot);
    expect(pressed()).toEqual(['false', 'false']);
    expect(getByText('Select a box above to show its line')).not.toBeNull();
  });

  it('does not change the selection on hover', () => {
    const { getAllByRole, getByText } = render(
      <AssignmentsSection trades={TRADES} prices={PRICES} holdings={HOLDINGS} />,
    );
    const [total, lot] = getAllByRole('button');
    if (!(total && lot)) throw new Error('missing boxes');
    fireEvent.click(total);
    fireEvent.mouseEnter(lot);
    expect(lot.getAttribute('aria-pressed')).toBe('false');
    expect(getByText('Select a box above to show its line')).not.toBeNull();
  });

  it('shows empty states when nothing was assigned or called', () => {
    const { container } = render(
      <AssignmentsSection trades={[]} prices={PRICES} holdings={HOLDINGS} />,
    );
    expect(container.textContent).toContain('No assigned shares yet.');
    expect(container.textContent).toContain('No covered calls yet.');
    expect(within(container).queryAllByText('Sample prices')).toHaveLength(2);
  });
});

describe('AssignmentsSection helpers', () => {
  it('formats signed percentages and dollars', () => {
    expect(fmtPct(12.345)).toBe('+12.3%');
    expect(fmtPct(-4)).toBe('−4.0%');
    expect(fmtUsd(2185.34)).toBe('+$2,185');
    expect(fmtUsd(-4260.02)).toBe('−$4,260');
    expect(fmtUsdAxis(15_000)).toBe('$15k');
    expect(fmtUsdAxis(-2500)).toBe('−$2.5k');
    expect(fmtUsdAxis(0)).toBe('$0k');
  });

  it('keeps one color per ticker across assigned and called lots', () => {
    const lot = (/** @type {string} */ ticker) =>
      /** @type {import('./assignments.js').Lot} */ ({ ticker });
    const colors = tickerColors([lot('AAA'), lot('BBB'), lot('AAA')]);
    expect(colors.size).toBe(2);
    expect(colors.get('AAA')).not.toBe(colors.get('BBB'));
  });

  it('gives eight tickers eight different colors', () => {
    const tickers = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'];
    const lots = tickers.map(
      (ticker) => /** @type {import('./assignments.js').Lot} */ ({ ticker }),
    );
    expect(new Set(tickerColors(lots).values()).size).toBe(8);
  });
});

describe('AssignmentsSection total sentences', () => {
  it('says behind when the shares trail the S&P 500', () => {
    const summary = {
      stock: 100,
      spx: 600,
      excess: -500,
      capital: 9500,
      atStrike: 10_000,
      fromFidelity: true,
    };
    expect(totalSentence(summary)).toBe(
      'Total: $500 behind the S&P 500; $9,500 basis = $10,000 deployed − $500 premium.',
    );
  });

  it('sums up covered calls, including a positive net', () => {
    const summary = {
      premiumKept: 900,
      upsideGivenUp: 300,
      net: 600,
      openPremium: 50,
      calls: 3,
      first: '',
      last: '',
    };
    expect(callsSentence(summary)).toBe(
      'Covered calls: $900 premium kept − $300 upside given up = +$600; open calls carry $50 premium not yet earned.',
    );
  });

  it('leaves out the deployed / premium breakdown without Fidelity lots', () => {
    const empty = { asOf: '2026-01-15', held: [], sold: [] };
    const { container } = render(
      <AssignmentsSection trades={TRADES} prices={PRICES} holdings={empty} />,
    );
    expect(container.textContent).toContain('Total: $2,000 ahead of the S&P 500; $20,000 basis. ');
    expect(container.textContent).toContain('ahead of the S&P 500');
    expect(container.textContent).not.toContain('deployed −');
  });
});

describe('AssignmentsSection chip colors', () => {
  it('colors gains green and losses red', () => {
    expect(toneClass(2185)).toBe('text-emerald-400');
    expect(toneClass(-2185)).toBe('text-rose-400');
  });
});

describe('AssignmentsSection strikes and colors', () => {
  it('formats strikes', () => {
    expect(fmtStrike(80)).toBe('$80');
    expect(fmtStrike(52.5)).toBe('$52.50');
  });
});
