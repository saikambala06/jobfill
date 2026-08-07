import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard sources stay in dashboard/; Vite treats that as its root and
// emits the built site to /dist, which is what Vercel serves as static output.
export default defineConfig({
  plugins: [react()],
  root: 'dashboard',
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    // Local only. In production the dashboard and API share an origin, so the
    // app's relative /api/... calls need no proxy and no base URL at all.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
});
