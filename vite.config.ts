import { defineConfig } from 'vite';
import path from 'path';
import solidPlugin from 'vite-plugin-solid';
import { agentBridge } from './plugins/agent-bridge';

export default defineConfig({
  plugins: [solidPlugin(), agentBridge()],
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
  build: {
    rollupOptions: {
      // 第二個入口是建築展示區（showcase.html）。它不載入遊戲，
      // 但使用正式的材質與變體註冊表，所以在那裡調的東西就是出貨的東西。
      input: {
        main: path.resolve(__dirname, 'index.html'),
        showcase: path.resolve(__dirname, 'showcase.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
});
