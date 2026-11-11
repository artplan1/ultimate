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
    // The concurrent tests here drive a browser over a booted server, and workspaces-integration.test.ts runs seven of
    // them five at a time while four files run at once: under machine load the file at the peak misses Playwright's own
    // 30 s locator wait, and a different one fails each run (the fast suite's vite.config.ts sets the same lever at
    // three, HazAT/ultimate#47). Two at a time instead: a full run measured 275 passed in 345 s against 274 passed and
    // one failure in 410 s, so the lower concurrency costs nothing in wall time.
    maxConcurrency: 2,
    // Like vite.config.ts: under an agent Vitest's minimal reporter is silent for passing files.
    reporters: ['default'],
  },
})
