import { useEffect, useState } from 'react';
import { loadAssignments, loadBenchmarks, loadTrades } from './data.js';
import TradingDashboard from './TradingDashboard.jsx';

const REFRESH_MS = 10 * 60 * 1000;

/**
 * An optional fetcher file (benchmarks.json, assignments.json), refreshed with
 * the trades; keeps the last good value on a failed fetch, like the trades.
 * @template T
 * @param {() => Promise<T | null>} loader
 * @param {string} name for console errors
 * @returns {T | null}
 */
function useOptional(loader, name) {
  const [value, setValue] = useState(/** @type {T | null} */ (null));
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await loader();
        if (active) setValue(next);
      } catch (e) {
        // biome-ignore lint/suspicious/noConsole: surface load failures to the browser console
        console.error(`${name} load failed`, e);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [loader, name]);
  return value;
}

export default function App() {
  const [state, setState] = useState(
    /** @type {{ trades: object[] | null; sig: string | null; updatedAt: string | null }} */ ({
      trades: null,
      sig: null,
      updatedAt: null,
    }),
  );
  const [error, setError] = useState(/** @type {unknown} */ (null));
  const benchmarks = useOptional(loadBenchmarks, 'benchmarks');
  const assignments = useOptional(loadAssignments, 'assignments');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { trades, sig, updatedAt } = await loadTrades();
        if (active) {
          setState({ trades, sig, updatedAt });
          setError(null);
        }
      } catch (e) {
        // Keep showing the last good data; only surface if we never loaded.
        if (active) setError(e);
        // biome-ignore lint/suspicious/noConsole: surface load failures to the browser console
        console.error('trades load failed', e);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!state.trades) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#09090b',
          color: '#a1a1aa',
          fontFamily: 'system-ui',
        }}
      >
        {error ? 'Could not load trades.json — is the fetcher running?' : 'Loading trades…'}
      </div>
    );
  }
  return (
    <TradingDashboard
      tradesData={state.trades}
      updatedAt={state.updatedAt}
      benchmarks={benchmarks}
      assignments={assignments}
      key={state.sig}
    />
  );
}
