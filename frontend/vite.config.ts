import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : '/static/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://localhost:32995',
        changeOrigin: true,
        secure: false,
      },
      '/static': {
        target: 'https://localhost:32995',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: 'wss://localhost:32996',
        ws: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: '../backend/static',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
}));
