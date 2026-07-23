import { useEffect, useState } from 'react';
import { loadTrades } from './data.js';
import TradingDashboard from './TradingDashboard.jsx';

const REFRESH_MS = 10 * 60 * 1000;

export default function App() {
  const [state, setState] = useState({ trades: null, sig: null });
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { trades, sig } = await loadTrades();
        if (active) {
          setState({ trades, sig });
          setError(null);
        }
      } catch (e) {
        // Keep showing the last good data; only surface if we never loaded.
        if (active) setError(e);
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
  return <TradingDashboard tradesData={state.trades} key={state.sig} />;
}
