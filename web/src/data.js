// Stable djb2 hash -> string. Used as a React key so the dashboard remounts
// only when trades.json content actually changes (preserves filters otherwise).
/**
 * @param {string} text
 * @returns {string}
 */
export function signature(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

/**
 * Fetch and parse trades.json, returning the data plus a content signature.
 * @param {string} [url]
 * @returns {Promise<{ trades: object[]; sig: string }>}
 */
export async function loadTrades(url = '/trades.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`trades.json fetch failed: ${res.status}`);
  const text = await res.text();
  return { trades: JSON.parse(text), sig: signature(text) };
}
