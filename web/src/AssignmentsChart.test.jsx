// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { cloneElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AssignmentsSection from './AssignmentsSection.jsx';

// jsdom has no layout, so ResponsiveContainer measures 0×0 and draws nothing.
// Give the chart a fixed size so the drawn lines can be asserted.
vi.mock('recharts', async (importOriginal) => {
  const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...actual,
    ResponsiveContainer: (/** @type {{ children: import('react').ReactElement }} */ { children }) =>
      cloneElement(children, { width: 800, height: 340 }),
  };
});

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
afterEach(cleanup);

const TOTAL_COLOR = '#e4e4e7';

/** @type {import('./assignments.js').PriceHistory} */
const PRICES = {
  asOf: '2026-01-22',
  series: {
    SPX: [
      ['2026-01-01', 1000],
      ['2026-01-08', 1010],
      ['2026-01-15', 1020],
      ['2026-01-22', 1030],
    ],
    AAA: [
      ['2026-01-01', 100],
      ['2026-01-08', 104],
      ['2026-01-15', 108],
      ['2026-01-22', 112],
    ],
  },
};

// AAA assigned at two strikes on Jan 1 (two lots, same color), the $90 lot
// sold Jan 15; AAA called away at 105 on Jan 15.
const TRADES = [
  {
    ticker: 'AAA',
    status: 'ASSIGNED',
    contracts: 1,
    strike: 90,
    closedOn: 'Jan 1, 26',
    exitPrice: 100,
  },
  {
    ticker: 'AAA',
    status: 'ASSIGNED',
    contracts: 1,
    strike: 100,
    closedOn: 'Jan 1, 26',
    exitPrice: 100,
  },
  {
    ticker: 'AAA',
    status: 'CALLED',
    contracts: 1,
    strike: 105,
    closedOn: 'Jan 15, 26',
    exitPrice: 108,
  },
];

/** @type {import('./assignments.js').Holdings} */
const HOLDINGS = {
  asOf: '2026-01-22',
  held: [{ ticker: 'AAA', acquired: '2026-01-01', quantity: 100, costBasis: 9800 }],
  sold: [
    {
      ticker: 'AAA',
      acquired: '2026-01-01',
      sold: '2026-01-15',
      quantity: 100,
      costBasis: 8900,
      proceeds: 10_600,
    },
  ],
};

const renderSection = () =>
  render(<AssignmentsSection trades={TRADES} prices={PRICES} holdings={HOLDINGS} />);

/**
 * Drawn lines in one card's chart as `stroke|dashed`.
 * @param {Element} card
 */
const lines = (card) =>
  [...card.querySelectorAll('path.recharts-line-curve')].map(
    (p) => `${p.getAttribute('stroke')}|${p.getAttribute('stroke-dasharray') ? 'dashed' : 'solid'}`,
  );

/** The two chart cards (Assigned, Covered Calls) and their boxes; skips Assumptions. */
function cards() {
  const all = [...document.querySelectorAll('.rounded-xl')].filter((c) =>
    c.querySelector('button'),
  );
  return all.map((card) => ({ card, boxes: [...card.querySelectorAll('button')] }));
}

/** @param {Element} box */
const swatch = (box) =>
  /** @type {HTMLElement | null} */ (box.querySelector('span[style]'))?.style.background;

describe('Assigned chart: only selected lines are drawn', () => {
  it('starts with just the Total line and its S&P 500 line', () => {
    renderSection();
    const [assigned] = cards();
    expect(lines(assigned?.card ?? document.body).sort()).toEqual([
      `${TOTAL_COLOR}|dashed`,
      `${TOTAL_COLOR}|solid`,
    ]);
  });

  it('adds a lot pair on click and removes it on a second click', () => {
    renderSection();
    const [assigned] = cards();
    const [, lot90] = assigned?.boxes ?? [];
    if (!(assigned && lot90)) throw new Error('missing box');
    fireEvent.click(lot90);
    expect(lines(assigned.card)).toHaveLength(4);
    fireEvent.click(lot90);
    expect(lines(assigned.card)).toHaveLength(2);
  });

  it('draws nothing and shows a hint when everything is deselected', () => {
    renderSection();
    const [assigned] = cards();
    const [total] = assigned?.boxes ?? [];
    if (!(assigned && total)) throw new Error('missing box');
    fireEvent.click(total);
    expect(lines(assigned.card)).toEqual([]);
    expect(assigned.card.textContent).toContain('Select a box above to show its line');
  });
});

describe('Assigned chart: markers', () => {
  it('dots the second same-ticker lot and rings each lot end (hollow once sold)', () => {
    renderSection();
    const [assigned] = cards();
    const [, lot90, lot100] = assigned?.boxes ?? [];
    if (!(assigned && lot90 && lot100)) throw new Error('missing boxes');
    fireEvent.click(lot90);
    fireEvent.click(lot100);
    const circles = [...assigned.card.querySelectorAll('circle')];
    // The $100 lot comes second, so only it gets the small dots.
    expect(circles.filter((c) => c.getAttribute('r') === '2.5').length).toBeGreaterThan(0);
    const rings = circles.filter((c) => c.getAttribute('r') === '4');
    // $90 lot sold Jan 15 → hollow ring; $100 lot still held → filled ring.
    expect(rings.map((c) => c.getAttribute('fill')).sort()).toEqual(['#111113', '#3987e5']);
  });
});

describe('Colors follow the ticker', () => {
  it('uses one color for a ticker across lots and cards', () => {
    renderSection();
    const [assigned, called] = cards();
    const boxes = [...(assigned?.boxes.slice(1) ?? []), ...(called?.boxes.slice(1) ?? [])];
    expect(boxes).toHaveLength(3);
    expect(new Set(boxes.map(swatch)).size).toBe(1);
  });
});
