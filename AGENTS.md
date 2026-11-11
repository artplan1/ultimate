# Ultimate

Ultimate is a local coding agent with a web UI, built on Pi Durable (`@earendil-works/pi-durable`), that runs this
repository while it edits it: you are probably reading this as Ultimate, about to change yourself. Below: how work is
organised, and which change reloads how.

## How work is organised: a forest of conversation trees

- **Roots** run no turns and keep a project memory (decisions, facts, lessons by slug); a branch starts from its memory
  index and recent landings. The root's read-only tally is the browsable project context, the **History** page, opened
  from the sidebar's project path; the Memory row there opens Memory. One root per project: independent work goes into
  branches. Roots and standing agents are never concluded or cleared, only compacted.
- **Onboarding.** Start with @ultimate (Continue on Get ready, or **Set up with @ultimate** on its Start here card): it
  writes the first memories with `remember`, and the user's answer about the project becomes instructions, kept verbatim
  as a memory. @ultimate maintains memory with `remember` and the memory review; ⌘K Compact compacts a tally.
- **A branch** is a feature, a fix, an experiment: @ultimate reads a root's tally and starts a coordinator branch from
  its memory brief (or its tally), then the prompt. A branch is never a subagent.
- **Talk to @ultimate in its conversation** (first sidebar row; phones: the top-bar button): the user's standing agent
  starts and steers branches there; conversations and roots are not created by hand.
- **Branches ask the user in their own conversation**: a coordinator sends its decisions to @ultimate, which weighs in
  (its picks, or deciding itself on a hands-off goal), then asks with a card; the answer reaches @ultimate as a note.
- **Coordinators carry the work** (labelled `branch · coordinator`): a branch plans, decides and verifies; subagents
  execute; the lander is the final gate on main.
- **Across the tree**: codemode `ultimate.entries(id)`, `ultimate.search()`, `note`, `notify`; a resume brings a
  catch-up of the tally, then new target commits, overlaps first.
- **State divergence**: reports and `workspace submit` say how the result differs from the task; "None" when it matches.
- **Conclude** a conversation when its work is done; it stays readable and resumable. A landing concludes its branch
  unless work is under way (a subagent, a reply, queued input), and wakes whoever started it; a failed submission wakes
  the branch.
- **UI polish lands when the user says so**: small look-and-feel work runs preview rounds (`ui-preview-round`) and is
  never submitted until the user approves it; larger UI features and anything with behaviour behind it land as usual.
- **Hands-off goals**: ⌘K Go hands-off puts @ultimate on a goal while the user is away; it gives the go, decisions and
  preview approvals in their place and records each with its reason (`extensions/goal/README.md`).

The mechanics are in [extensions/lineage/README.md](extensions/lineage/README.md).

## Layers and how they reload

- `extensions/<name>/web.tsx`: an extension's UI (slots, panels, surfaces, renderers, commands), rebuilt ~2 s after a
  save, open pages switching with drafts and view kept; a broken facet shows an error card.
- `extensions/<name>/server.ts`: agent behaviour (prompt, tools, hooks), reinstalled on save, running calls finishing on
  the old code.
- `extensions/<name>/api.ts`: its contract for other extensions, live with the facets that import it; `tier = 'core'` is
  the always-on core tier ([docs](docs/extensions/core-tier.md)).
- `lib/`: pure helpers extensions share, no state and no imports; with them.
- `web/`: the web core (surface host, primitives, SDK, transcript, composer, palette); like a `web.tsx`.
- `agents/`: subagent definitions; read at each use.
- `server/`, `shared/`: core plumbing; `restart`, which boots and type-checks a new process beside the old one, which
  survives a failure, and the run resumes there.
- `bin/`: the supervisor; a human `pnpm start`. Keep it tiny and change it rarely.
- Put behaviour in `extensions/`, not `server/`: it reloads without a restart. The browser bundle (`server/web.ts`,
  [running](docs/running.md)) rebuilds in a child process, and open pages reload onto it, resuming their view and drafts.
  A surface is a full-screen app (header, ⌘K, `mod+1…9`); a project's apps go in `<project>/.ultimate/extensions/`
  ([surfaces](docs/extensions/surfaces.md)). New UI is a new extension folder, not a change to `web/`: follow
  `write-extension` into [extensions/README.md](extensions/README.md) and copy the closest one (`status-line`,
  `coding-tools`).

## Developer reference — read when needed

- [Running the server](docs/running.md): starting, debugging or testing a server or core swap.
- [Worktrees](docs/worktrees.md): a preview in an isolate, landing, a rejected push.
- [Settings](docs/settings.md): configuration, trust, resources, `summaryModel`.
- [Durability](docs/durability.md): persistence, replay, durable UI state.
- [Extension topics](extensions/README.md#topics): facets, contracts, documents, events, introspection.
- [Subagents](docs/subagents.md): delegating, definitions, the review team.
- [Pi](docs/pi-upstream.md): upgrades and upstream couplings, its [searching Pi's
  code](docs/pi-upstream.md#searching-pis-code) first.

## Push permission

The top-level agent may commit verified work, land it and normally push the destination branch to `origin`
(`HazAT/ultimate`), public or private, without asking; `workspace submit` runs checks and pushes. Subagents commit and
report, never push. Never force-push, rewrite history or push secrets. This does not cover other repositories, releases,
publishing, deployments or GitHub issue/PR changes ([a rejected push](docs/worktrees.md)).

## Conventions

- Discovery goes through the `search` tool; `bash` is for git, builds, tests and one-off shell work, not `rg`/`grep`
  lookups.
- Keep local conversation/thread IDs out of new commit messages and GitHub PR titles, bodies and comments; provenance
  stays in Ultimate's private events, not public Git metadata.
- Pi is the role model: minimal, readable, malleable; prefer platform features and existing dependencies, and justify
  every new dependency in its commit message.
- Public docs, READMEs, prompts, agent definitions, skills and code comments use generic names and examples, never a
  real person's name, machine names, private repos or real IPs; LICENSE, attributions and real repo URLs are exempt.
- `pnpm check` enforces import boundaries and runs `pnpm deps`, which fails on a cycle or a core-tier extension depending
  on an optional one.
- Plain TypeScript, ESM, Node 26, erasable syntax only (no enums, namespaces or parameter properties), relative imports
  end in `.ts`.
- Core contracts in `shared/protocol.ts`; extension types with their extension.
- Pin `@earendil-works/*` to exact versions; Pi Durable is experimental.
- Tests live with what they test: an extension's in `extensions/<name>/test/` (`test/web/`, `test/e2e/`), the core's and
  cross-extension ones in the top-level `test/` with the shared helpers; `pnpm test [path]` and `pnpm test:e2e [path]`
  run a part. An extension's `test/` is no part of it: no reload, out of the import rules and `pnpm deps`
  ([layout](extensions/README.md#tests)).
- `pnpm check` (format, lint, types) and the tests covering your change pass before a commit; the lander runs every
  suite. No real waits or spawned processes in `pnpm test` (those go to `test/e2e`), and a flaky test is fixed or
  deleted, never skipped or given a longer timeout (`ultimate/no-test-timeout`, `ultimate/no-real-wait-in-fast-tests`, a
  justified exception needing `fast-test-reason:`). Use the real-deadline `until` from `test/helpers.ts`, not polling
  (`ultimate/no-local-test-polling`); `ultimate/no-retired-ui` keeps retired labels and surfaces out of extensions and
  web code.
- Every user-visible result is designed, not dumped: status and outcomes (a subagent report, a landing, a failure) get a
  renderer matching the existing cards, never plain Markdown. Look at the running app and recent screenshots first, write
  the expected look into task descriptions, and check a worker's screenshots against it.

## Review quality

Rules about agent behaviour live in prompts and agent definitions, not in code; code checks protect only safety and
invalid states; lint enforces only what the user asked for.

A swallowed error needs a reason comment (`ultimate/no-silent-catch`). Code that exists because of something outside it
names its origin (the issue or PR URL, our PR number, the `#conversation`), what breaks without it and when it can go.

Reject slop and jargon; no compatibility shims or speculative fallbacks: move forward and update callers. Commit a test
for a feature's core path and one regression test per bug that happened, exercising behaviour and failure cases rather
than restating the implementation; prove other edge cases once and show the command and its output; one-off migrations
get no test.
