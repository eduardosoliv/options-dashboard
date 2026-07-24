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
    const lastModified = 'Wed, 23 Jul 2026 20:51:00 GMT';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(body),
      headers: { get: () => lastModified },
    });
    const { trades, sig, updatedAt } = await loadTrades('/trades.json');
    expect(trades).toEqual([{ ticker: 'JPM' }]);
    expect(sig).toBe(signature(body));
    expect(updatedAt).toBe(lastModified);
  });
  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(loadTrades('/trades.json')).rejects.toThrow('404');
  });
});
