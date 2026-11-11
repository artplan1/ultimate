import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['test/sweep-temp.ts'],
    setupFiles: ['test/setup.ts'],
    include: ['test/e2e/**/*.test.ts', 'extensions/*/test/e2e/**/*.test.ts'],
    testTimeout: 60_000,
    // A cleanup closes a Vite watcher over a full repository copy; under load that took 27 s here, while
    // everything else in the same run finished within 3 s. Vitest's 10 s default is not a budget anyone chose.
    hookTimeout: 60_000,
    maxWorkers: 4,
    // Like vite.config.ts: under an agent Vitest's minimal reporter is silent for passing files.
    reporters: ['default'],
  },
})
