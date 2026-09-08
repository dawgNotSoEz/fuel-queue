import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ------------------------------------------------------------------
// FUELWISE — Vite configuration
//
// envDir is pointed at the REPOSITORY ROOT ("..") because the shared
// .env file lives one level above this frontend folder. Vite will
// expose only the VITE_-prefixed variables to the client bundle.
// ------------------------------------------------------------------
export default defineConfig({
  plugins: [react()],
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
