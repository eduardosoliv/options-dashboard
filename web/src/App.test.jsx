// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import trades from '../trades-example.json';
import App from './App.jsx';

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TBILL_NOTE = /T-bill interest on collateral/;

const json = (body) => ({
  ok: true,
  status: 200,
  headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) },
  text: () => Promise.resolve(JSON.stringify(body)),
  json: () => Promise.resolve(body),
});

/** Mocks fetch: trades.json always loads; benchmarks.json gets `benchmarks`. */
const mockFetch = (benchmarks) => {
  global.fetch = vi.fn((url) =>
    Promise.resolve(url === '/trades.json' ? json(trades) : benchmarks),
  );
};

/** Waits for the dashboard, then returns the Yield vs Benchmarks section's text. */
const benchmarkSection = async () => {
  await screen.findByText('Yield vs Benchmarks');
  const text = document.body.textContent;
  return text.slice(text.indexOf('Yield vs Benchmarks'), text.indexOf('Premium & Buybacks'));
};

describe('App benchmarks', () => {
  it('passes benchmarks.json through to the dashboard', async () => {
    mockFetch(json({ putReturn: 15.2, tbillReturn: 4, period: '1Y to Sep 30, 2026' }));
    render(<App />);
    await screen.findByText(TBILL_NOTE);
    const text = await benchmarkSection();
    expect(text).toContain('· 1Y to Sep 30, 2026');
    expect(text).toContain('Short put yield + 4.00% T-bill interest on collateral (assumed)');
    expect(text).toContain('Benchmark: PutWrite (PUT)15.20%');
    expect(global.fetch).toHaveBeenCalledWith('/benchmarks.json', { cache: 'no-store' });
  });

  it('shows the config prompts when benchmarks.json is missing', async () => {
    mockFetch({ ok: false, status: 404 });
    render(<App />);
    const text = await benchmarkSection();
    expect(text).toContain('Set [benchmarks] tbill_return in config.toml');
    expect(text).toContain('Set [benchmarks] put_return in config.toml');
  });

  it('still renders the dashboard when benchmarks.json fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      /* expected: the failure is logged */
    });
    mockFetch({ ok: false, status: 500 });
    render(<App />);
    const text = await benchmarkSection();
    expect(text).toContain('Short Put Yield');
    expect(text).toContain('Set [benchmarks] put_return in config.toml');
  });
});

// Made-up broker lot and prices for the example data's MSFT assignment.
const ASSIGNMENTS = {
  asOf: '2026-03-20',
  held: [{ ticker: 'MSFT', acquired: '2026-02-20', quantity: 100, costBasis: 42_000 }],
  sold: [],
  series: {
    SPX: [
      ['2026-02-20', 6000],
      ['2026-03-20', 6120],
    ],
    MSFT: [
      ['2026-02-20', 400],
      ['2026-03-20', 440],
    ],
  },
};

/** Mocks fetch per file name: trades.json always loads. */
const mockFiles = (/** @type {Record<string, unknown>} */ files) => {
  global.fetch = vi.fn((url) =>
    Promise.resolve(
      url === '/trades.json' ? json(trades) : (files[url] ?? { ok: false, status: 404 }),
    ),
  );
};

/** Waits for the dashboard, then returns the Assigned & Called section's text. */
const assignedSection = async () => {
  await screen.findByText('Yield vs Benchmarks');
  const text = document.body.textContent;
  return text.slice(text.indexOf('Assigned & Called'), text.indexOf('Winners & Losers'));
};

describe('App assignments', () => {
  it('passes assignments.json through to the Assigned & Called section', async () => {
    mockFiles({ '/assignments.json': json(ASSIGNMENTS) });
    render(<App />);
    await screen.findByText('Assigned Shares');
    const text = await assignedSection();
    // 100 MSFT on a $420 basis, now 440 → +$2,000.
    expect(text).toContain('MSFT×1 $435basis $420.00');
    expect(text).toContain('+$2,000');
    expect(global.fetch).toHaveBeenCalledWith('/assignments.json', { cache: 'no-store' });
  });

  it('shows the setup hint when assignments.json is missing', async () => {
    mockFiles({});
    render(<App />);
    expect(await assignedSection()).toContain('No assignments.json yet');
  });

  it('still renders the dashboard when assignments.json fails to load', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {
      /* expected: the failure is logged */
    });
    mockFiles({ '/assignments.json': { ok: false, status: 500 } });
    render(<App />);
    expect(await assignedSection()).toContain('No assignments.json yet');
    expect(logged).toHaveBeenCalled();
  });
});
