import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'esnext',
  },
});
