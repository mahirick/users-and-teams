import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      '/auth': { target: 'http://127.0.0.1:3100', changeOrigin: false },
      '/me': { target: 'http://127.0.0.1:3100', changeOrigin: false },
      '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false },
      '/teams': { target: 'http://127.0.0.1:3100', changeOrigin: false },
      '/avatars': { target: 'http://127.0.0.1:3100', changeOrigin: false },
      '^/admin(/.*)?$': { target: 'http://127.0.0.1:3100', changeOrigin: false },
    },
  },
  // Force a single React copy when the package resolves react via its peer dep —
  // prevents the "Invalid hook call" duplicate-React error.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
});
