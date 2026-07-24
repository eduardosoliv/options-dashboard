import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTrades, signature } from './data.js';

afterEach(() => vi.restoreAllMocks());

describe('signature', () => {
  it('is stable for identical input', () => {
    expect(signature('abc')).toBe(signature('abc'));
  });
  it('differs for different input', () => {
    expect(signature('abc')).not.toBe(signature('abd'));
  });
  it('handles empty string', () => {
    expect(typeof signature('')).toBe('string');
  });
});

describe('loadTrades', () => {
  it('parses and signs fetched json', async () => {
    const body = JSON.stringify([{ ticker: 'JPM' }]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(body) });
    const { trades, sig } = await loadTrades('/trades.json');
    expect(trades).toEqual([{ ticker: 'JPM' }]);
    expect(sig).toBe(signature(body));
  });
  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(loadTrades('/trades.json')).rejects.toThrow('404');
  });
});
