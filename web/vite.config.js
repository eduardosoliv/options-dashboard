// biome-ignore lint/correctness/noNodejsModules: vite.config runs in Node, not the browser
import { readFile, stat } from 'node:fs/promises';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The fetcher writes `dist/trades.json` (and `dist/benchmarks.json` when
// configured), which the production build serves. The dev server only serves
// `public/`, so without this the app 404s on them during `just dev`. Serve the
// fetcher's output from dist instead of duplicating the files.
const FETCHER_FILES = ['trades.json', 'benchmarks.json'];

/**
 * @param {URL} [distDir] directory holding the fetcher's output (default: ./dist/)
 */
export function serveFetcherOutputInDev(distDir = new URL('./dist/', import.meta.url)) {
  return {
    name: 'serve-fetcher-output-in-dev',
    apply: 'serve',
    configureServer(server) {
      for (const name of FETCHER_FILES) {
        const fileUrl = new URL(name, distDir);
        server.middlewares.use(`/${name}`, async (_req, res) => {
          try {
            const [data, info] = await Promise.all([readFile(fileUrl), stat(fileUrl)]);
            res.setHeader('Content-Type', 'application/json');
            // Expose the fetcher's write time (mimics python http.server / vite preview).
            res.setHeader('Last-Modified', info.mtime.toUTCString());
            res.end(data);
          } catch {
            res.statusCode = 404;
            res.end(`${name} not found — run \`just fetch\` first`);
          }
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveFetcherOutputInDev()],
  base: '/',
});
