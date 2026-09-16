import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './', // required: Capacitor serves from a file-ish origin, never absolute paths
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Keep three.js in its own chunk so the app shell parses/boots fast.
        manualChunks: { three: ['three'] },
      },
    },
  },
  server: { host: true, port: 5173 },
});
