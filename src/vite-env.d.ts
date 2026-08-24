/// <reference types="vite/client" />

// The types for `import.meta.hot`, the HMR channel the agent bridge's page side uses, and
// `import.meta.env.DEV`. Here rather than in tsconfig's `types` field, because filling that field
// excludes every other @types package, vitest's included.
