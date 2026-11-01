import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBenchmarks, loadTrades, signature } from './data.js';

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

describe('loadBenchmarks', () => {
  const json = { get: () => 'application/json' };
  it('parses benchmarks.json', async () => {
    const bench = { putReturn: 7.5, tbillReturn: 4, period: '2025-2026' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: json,
      json: () => Promise.resolve(bench),
    });
    await expect(loadBenchmarks('/benchmarks.json')).resolves.toEqual(bench);
  });
  it('resolves null when benchmarks are not configured (404)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(loadBenchmarks('/benchmarks.json')).resolves.toBeNull();
  });
  it('resolves null for the HTML page a SPA fallback serves in its place', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });
    await expect(loadBenchmarks('/benchmarks.json')).resolves.toBeNull();
  });
  it('throws on other failures so the last good value is kept', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(loadBenchmarks('/benchmarks.json')).rejects.toThrow('500');
  });
});
