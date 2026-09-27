import { defineConfig } from 'vite'

// `npm run dev` serves on :5173 and forwards /api (REST and the /api/ws WebSocket) to the backend.
// Leave changeOrigin off: the backend's WebSocket Origin check needs Origin and Host to match.
// Without a backend, open http://localhost:5173/?demo for the in-browser demo data (src/mock.js).
export default defineConfig({
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
  build: {
    // three.js is a lazy chunk (the 3D view only); it is ~150 kB gzipped by itself
    chunkSizeWarningLimit: 700,
  },
})
