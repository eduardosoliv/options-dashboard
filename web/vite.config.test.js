// biome-ignore lint/correctness/noNodejsModules: tests the Node-side dev server middleware
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
// biome-ignore lint/correctness/noNodejsModules: tests the Node-side dev server middleware
import { tmpdir } from 'node:os';
// biome-ignore lint/correctness/noNodejsModules: tests the Node-side dev server middleware
import { join } from 'node:path';
// biome-ignore lint/correctness/noNodejsModules: tests the Node-side dev server middleware
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serveFetcherOutputInDev } from './vite.config.js';

/** Registers the plugin on a fake dev server and returns its middlewares by path. */
const middlewaresFor = (distDir) => {
  const handlers = new Map();
  serveFetcherOutputInDev(distDir).configureServer({
    middlewares: { use: (path, handler) => handlers.set(path, handler) },
  });
  return handlers;
};

/** Calls a middleware with a fake response and resolves with what it sent. */
const request = (handler) =>
  new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (name, value) => {
        headers[name] = value;
      },
      end: (body) => resolve({ status: res.statusCode, headers, body: String(body) }),
    };
    handler({}, res);
  });

describe('serveFetcherOutputInDev', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dist-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('only applies to the dev server', () => {
    expect(serveFetcherOutputInDev().apply).toBe('serve');
  });

  it('serves both trades.json and benchmarks.json', () => {
    expect([...middlewaresFor(pathToFileURL(`${dir}/`)).keys()]).toEqual([
      '/trades.json',
      '/benchmarks.json',
    ]);
  });

  it('serves benchmarks.json as JSON with its write time', async () => {
    const body = JSON.stringify({ putReturn: 15.2, tbillReturn: 4, period: null });
    await writeFile(join(dir, 'benchmarks.json'), body);
    const handler = middlewaresFor(pathToFileURL(`${dir}/`)).get('/benchmarks.json');
    const res = await request(handler);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(Number.isNaN(Date.parse(res.headers['Last-Modified']))).toBe(false);
    expect(JSON.parse(res.body)).toEqual({ putReturn: 15.2, tbillReturn: 4, period: null });
  });

  it('404s (not the SPA fallback) when a file is missing', async () => {
    const handler = middlewaresFor(pathToFileURL(`${dir}/`)).get('/benchmarks.json');
    const res = await request(handler);
    expect(res.status).toBe(404);
    expect(res.body).toContain('benchmarks.json not found');
  });
});
