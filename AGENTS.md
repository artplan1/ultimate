# Ultimate

Ultimate is a local coding agent with a web UI, built on Pi Durable (`@earendil-works/pi-durable`), that runs this
repository while it edits it. Below: how work is organised, and which change reloads how.

## How work is organised: a forest of conversation trees

- **Roots** run no turns and keep a project memory (decisions, facts, lessons by slug); a branch starts from its memory
  index and recent landings. Its read-only tally is the browsable project context, the **History** page, opened from
  the sidebar's project path. One root per project: independent work goes into branches. Roots and standing agents are
  never concluded or cleared, only compacted.
- **Onboarding.** Start with @ultimate: it writes the first memories with `remember`, and the user's answer about the
  project becomes instructions, kept verbatim as a memory. @ultimate maintains memory with `remember` and the memory
  review; ⌘K Compact compacts a tally.
- **A branch** is a feature, a fix, an experiment: @ultimate reads a root's tally and starts a coordinator branch from
  its memory brief (or its tally), then the prompt. A branch is never a subagent.
- **Branches ask the user through @ultimate**: a coordinator sends its decisions there, which weighs in, then asks
  with a card; the answer comes back as a note.
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

- An extension is `extensions/<name>/`: `web.tsx` (its UI), `server.ts` (agent behaviour), `api.ts`/`refs.ts`/
  `ui.tsx` (its contracts), a README. It reloads on save, without a restart ([what reloads
  how](docs/running.md#what-reloads-how)).
- `lib/`: pure helpers extensions share. `web/`: the web core. `agents/`: subagent definitions, reread at every start.
  `server/`, `shared/`: core plumbing, `restart` only; `bin/`: the supervisor, keep it tiny and change it rarely.
- Put behaviour in `extensions/`, not `server/`.
- A surface is a full-screen app; a project's apps go in `<project>/.ultimate/extensions/`
  ([surfaces](docs/extensions/surfaces.md)). New UI is a new extension folder, not a change to `web/`: follow
  `write-extension` into [extensions/README.md](extensions/README.md) and copy the closest one.

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
- Plain TypeScript, ESM, Node 26, erasable syntax only (no enums, namespaces or parameter properties), relative imports
  end in `.ts`.
- Core contracts in `shared/protocol.ts`; extension types with their extension.
- Pin `@earendil-works/*` to exact versions; Pi Durable is experimental.
- Tests live with what they test: an extension's in `extensions/<name>/test/` with `test/web/` and `test/e2e/`, the
  core's and cross-extension ones in the top-level `test/` with the shared helpers ([tests](docs/conventions.md#tests)).
- `pnpm check` (format, lint, types; it fails on an import cycle or a core-tier extension depending on an optional one)
  and the tests covering your change pass before a commit; the lander runs every suite. No real waits or spawned
  processes in `pnpm test`; fix or delete a flaky test, never skip it or give it a longer timeout; wait with `until`
  from `test/helpers.ts`, not a loop of your own; keep retired labels and surfaces out
  ([checks and lint rules](docs/conventions.md#lint-rules)).
- Every user-visible result is designed, not dumped: status and outcomes get a card matching the existing ones, never
  plain Markdown; write the expected look into the task and check screenshots against it
  ([cards](docs/conventions.md#designed-not-dumped)).

## Review quality

Rules about agent behaviour live in prompts and agent definitions, not in code; code checks protect only safety and
invalid states; lint enforces only what the user asked for.

A swallowed error needs a reason comment (`ultimate/no-silent-catch`). Code that exists because of something outside it
names its origin (the issue or PR URL, our PR number, the `#conversation`), what breaks without it and when it can go.

Reject slop and jargon; no compatibility shims or speculative fallbacks: move forward and update callers. Commit a test
for a feature's core path and one regression test per bug that happened, exercising behaviour and failure cases rather
than restating the implementation; prove other edge cases once and show the command and its output; one-off migrations
get no test.
