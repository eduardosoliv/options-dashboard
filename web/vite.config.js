// biome-ignore lint/correctness/noNodejsModules: vite.config runs in Node, not the browser
import { readFile, stat } from 'node:fs/promises';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The fetcher writes `dist/trades.json`, which the production build serves. The
// dev server only serves `public/`, so without this the app 404s on
// `/trades.json` during `just dev`. Serve the fetcher's output from dist instead
// of duplicating the file.
function serveTradesInDev() {
  const tradesUrl = new URL('./dist/trades.json', import.meta.url);
  return {
    name: 'serve-trades-json-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/trades.json', async (_req, res) => {
        try {
          const [data, info] = await Promise.all([readFile(tradesUrl), stat(tradesUrl)]);
          res.setHeader('Content-Type', 'application/json');
          // Expose the fetcher's write time (mimics python http.server / vite preview).
          res.setHeader('Last-Modified', info.mtime.toUTCString());
          res.end(data);
        } catch {
          res.statusCode = 404;
          res.end('trades.json not found — run `just fetch` first');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveTradesInDev()],
  base: '/',
});
