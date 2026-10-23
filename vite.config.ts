import { defineConfig } from 'vite';

export default defineConfig({
  // Serve directly from /src where index.html is located
  root: 'src',
  // Resolve asset paths relatively for Electron's file:// protocol
  base: './',
  server: {
    // Expose dev server on all network interfaces (0.0.0.0) for LAN play
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});

