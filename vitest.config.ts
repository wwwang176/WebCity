import { defineConfig } from 'vitest/config';
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
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    /**
     * vitest 預設的 5 秒對這個 repo 太緊。
     *
     * 模擬的測試會真的跑幾百到一千個 tick —— 單機最慢的一條約 3.4 秒，全套平行
     * 跑時大約會翻倍。5 秒只剩不到一倍餘裕，於是「單獨跑綠、全套跑紅」，而且
     * 每次紅的檔案都不一樣。那不是 bug 的特徵，是負載的特徵。
     *
     * 以前是逐條補 `}, 30000)`（Integration、Economy 各一次），但問題會在下一個
     * 吃 tick 的測試上復發。逾時的職責是抓「卡住不動」，不是抓「比較慢」。
     */
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
