import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/teams': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  resolve: {
    // Order matters: longer (more specific) aliases must come first so they
    // match before the bare module alias.
    alias: [
      {
        find: '@mahirick/users-and-teams/styles.css',
        replacement: resolve(__dirname, '../../src/ui/styles.css'),
      },
      {
        find: '@mahirick/users-and-teams/react',
        replacement: resolve(__dirname, '../../src/react.ts'),
      },
      {
        find: '@mahirick/users-and-teams',
        replacement: resolve(__dirname, '../../src/index.ts'),
      },
    ],
  },
});
