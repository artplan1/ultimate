## Conventions: why the checks are as tight as they are

The rules themselves are in [AGENTS.md](../AGENTS.md#conventions); this page holds the reasoning, the mechanics and
the examples behind the ones that are easy to work around by accident.

### Tests

`pnpm test` runs the fast, in-process tests on scripted model responses (about a minute today), which is what makes
running it before every commit worth it. `pnpm test:e2e` runs the tests that spawn a supervisor or drive a browser.
A sleep or a spawned process in the fast suite slows everyone down, so it belongs in `test/e2e`, never in `pnpm test`
with a longer timeout.

Test files live beside what they test: `extensions/<name>/test/` with `test/web/` and `test/e2e/`, and the core's and
cross-extension ones in the top-level `test/` with the shared helpers (`helpers.ts`: `fauxServer`, `temp`, `until`).
An extension's `test/` is not part of the extension: saving a test reloads nothing, and its imports stay out of the
import rules and `pnpm deps`. `pnpm test [path]` and `pnpm test:e2e [path]` run a part; the layout is spelled out in
[extensions/README.md#tests](../extensions/README.md#tests).

A flaky test is fixed or deleted. A skipped test hides its regression forever, and a raised timeout hides a race until
it fails on someone else's machine. Waiting uses `until` from `test/helpers.ts`: it polls against a real deadline and
says what it was still waiting for, where a local loop fails with a bare timeout.

### Lint rules

`pnpm check` is format, lint and types, then `pnpm deps` (import boundaries; it fails on a cycle or a core-tier
extension depending on an optional one) and `pnpm pi-upstream`. The rules guarding these pages, and what each catches:

- `ultimate/no-test-timeout` — `it('lands', run, 5000)` or `vi.setConfig({ testTimeout: 30_000 })`.
- `ultimate/no-real-wait-in-fast-tests` — `child_process` in a fast test, or `await setTimeout(…)` without
  `vi.useFakeTimers()`. A justified exception carries a `fast-test-reason: …` comment above it
  (`test/process-group.test.ts`).
- `ultimate/no-local-test-polling` — a locally declared `until` or `waitFor` instead of the shared one.
- `ultimate/no-retired-ui` — a retired label (`Branch from here`, `Clear context`, `New conversation`) or a `board`
  surface.
- `ultimate/no-silent-catch` — a `catch` that swallows an error with no comment saying why that is correct: say why, or
  handle it.

Commit a test for a feature's core path and one regression test per bug that actually happened. Prove every other edge
case once (a throwaway test, an action call, a preview) and show the command and its output in the report; one-off
migrations get none. A test that restates declarative code, or asserts that removed code is absent, adds a file to
maintain and proves nothing.

### Designed, not dumped

A status or an outcome — a subagent's report, a landing, a failure, a preview — is a card built from the existing
primitives, never plain Markdown in a message. The ones to copy: `subagents.report` (`extensions/subagents/web.tsx`),
the landing card (`extensions/workspaces/web.tsx` renders a `lineage.note` carrying `source: 'lander'`, plus
`workspaces.lander-report` and `ultimate.lander`), `watchdog.failure` (`extensions/watchdog/web.tsx`), and notices
(`extensions/notices`). Entry renderers receive `core`, the rendering so far, and fall back to it
([renderers](extensions/renderers.md)).

Before building one, look at the running app and recent screenshots and write the expected look into the task: what it
must make obvious at a glance. When the work comes back, check its screenshots against that look, not against the
task's prose.
