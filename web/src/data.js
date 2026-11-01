// Stable djb2 hash -> string. Used as a React key so the dashboard remounts
// only when trades.json content actually changes (preserves filters otherwise).
/**
 * @param {string} text
 * @returns {string}
 */
export function signature(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: djb2 hashing requires bitwise math
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: unsigned 32-bit conversion
  return String(h >>> 0);
}

/**
 * Fetch and parse trades.json, returning the data plus a content signature and
 * the file's Last-Modified time (when the fetcher last wrote it).
 * @param {string} [url]
 * @returns {Promise<{ trades: object[]; sig: string; updatedAt: string | null }>}
 */
export async function loadTrades(url = '/trades.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`trades.json fetch failed: ${res.status}`);
  const updatedAt = res.headers.get('last-modified');
  const text = await res.text();
  return { trades: JSON.parse(text), sig: signature(text), updatedAt };
}

/**
 * @typedef {{ putReturn: number | null; tbillReturn: number | null; period: string | null }} Benchmarks
 */

/**
 * Fetch benchmarks.json (PUT index return + T-bill rate from config.toml).
 * Resolves to null when the file doesn't exist (benchmarks not configured) —
 * a 404, or the HTML page Vite's SPA fallback serves in its place; throws on
 * any other failure so the caller can keep its last good value.
 * @param {string} [url]
 * @returns {Promise<Benchmarks | null>}
 */
export async function loadBenchmarks(url = '/benchmarks.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`benchmarks.json fetch failed: ${res.status}`);
  if (!res.headers.get('content-type')?.includes('json')) return null;
  return /** @type {Benchmarks} */ (await res.json());
}
