import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@workers': path.resolve(__dirname, 'src/workers'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@input': path.resolve(__dirname, 'src/input'),
      '@audio': path.resolve(__dirname, 'src/audio'),
      '@save': path.resolve(__dirname, 'src/save'),
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
  },
});
