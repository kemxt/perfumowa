import { defineConfig } from 'vite';

export default defineConfig({
  // appType 'spa' (domyślny) – dev server zwraca index.html dla /perfumy/:slug.
  appType: 'spa',
  server: { port: 5173 },
  build: { target: 'es2022' },
});
