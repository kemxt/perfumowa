import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Worker z API (wrangler dev) – patrz scripts/dev.mjs. */
const API = 'http://127.0.0.1:8787';

export default defineConfig({
  // appType 'spa' (domyślny) – dev server zwraca index.html dla /perfumy/:slug.
  appType: 'spa',
  server: {
    port: 5173,
    proxy: { '/api': API, '/media': API },
  },
  build: {
    target: 'es2022',
    // Pliki z hashem trafiają do /_app, a /assets zostaje dla zdjęć z public/assets
    // (różne reguły cache w public/_headers).
    assetsDir: '_app',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
      },
    },
  },
});
