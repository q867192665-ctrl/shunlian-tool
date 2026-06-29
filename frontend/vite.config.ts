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
    // 不清空整个 static 目录，避免删除旧版本静态资源导致刷新中的用户 404
    // 旧 hash 资源会保留在 assets/ 中，直到下次手动清理
    emptyOutDir: false,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
}));
