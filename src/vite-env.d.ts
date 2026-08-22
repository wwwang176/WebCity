/// <reference types="vite/client" />

// `import.meta.hot`（HMR 通道，agent 橋接的頁面端在用）與 `import.meta.env.DEV`
// 的型別。放在這裡而不是 tsconfig 的 `types` 欄位 —— 那個欄位一填就會把其他
// @types 套件排除掉，包括 vitest 的。
