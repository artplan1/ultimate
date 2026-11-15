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

## Landing and pushing

The top-level agent stops after changing repository files and running the checks that cover them: it names the changed
paths, the checks and the risks, and asks the user to review the working tree. Committing, amending, landing, pushing
and opening or changing a pull request wait for that approval, which covers exactly that handoff. `workspace submit`
then merges, runs the source project's configured checks, fast-forwards the target branch and pushes it only when
`lander.push` is set, which it is not here, so landings stay local and report "Not pushed." Subagents commit and report,
never push. Never force-push, rewrite history or push secrets, and this covers no other repository's releases,
publishing, deployments or GitHub issue/PR changes ([landing and pushing](docs/worktrees.md)).

## Conventions

- Discovery goes through the `grep` tool for file contents and the `find` tool for paths; `bash` is for git, builds, tests
  and one-off shell work, not shell `rg`/`grep`/`find` lookups.
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
  and the tests covering your change pass before a commit; the lander runs only `lander.checks` (here `pnpm check`), so
  your branch owns its suites. No real waits or spawned processes in `pnpm test`; fix or delete a flaky test, never
  skip it or give it a longer timeout; wait with `until` from `test/helpers.ts`, not a loop of your own. Tests may break
  production rules when that makes them simpler and more robust; different rules apply to them.
- Every user-visible result is designed, not dumped: status and outcomes get a card matching the existing ones, never
  plain Markdown; write the expected look into the task and check screenshots against it
  ([cards](docs/conventions.md#designed-not-dumped)).

## Review quality

Rules about how agents behave live in prompts and agent definitions, not in code. Code checks protect only safety and
invalid states: data loss, security, impossible states. Lint enforces only what the user explicitly asked for, and
every lint message says why we don't want the pattern and what to do instead.

The code base is the example every agent copies, so it carries no exceptions to copy: fix the code rather than explain
or excuse it. Code that exists only because of something outside it (an upstream bug, a provider quirk, an edge case
found in the wild) gets its reason in its commit message and a regression test that fails without it.

Each rule and what enforces it. A new check proves in its test that it fails on a real past mistake; a rule leaves the
table once its mistake can no longer happen.

| Rule                                                                     | Enforced by                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Time is never a stand-in for an event; timers only through named helpers | `ultimate/no-raw-timer`, `lib/timers.ts`                            |
| Extensions meet only at contracts; the core tier runs without the rest   | `ultimate/api-only-imports`, `ultimate/core-tier-deps`, `pnpm deps` |
| Contract files hold only documented contracts, named for their owner     | `ultimate/api-file-shape`, `ultimate/api-naming`                    |
| Extension UI reaches the server only through the SDK                     | `ultimate/no-raw-stream`                                            |
| No swallowed errors                                                      | `ultimate/no-silent-catch`                                          |
| A call is replay-safe only when a rerun cannot do harm                   | `ultimate/replay-safe-by-name`, `lib/replay.ts`                     |
| Fast tests are in-process, deterministic and keep the default timeout    | `ultimate/no-real-wait-in-fast-tests`, `ultimate/no-test-timeout`   |
| One polling helper in tests                                              | `ultimate/no-local-test-polling`                                    |
| A switch over a union names every case                                   | `typescript/switch-exhaustiveness-check`                            |
| Pi couplings are listed and marked                                       | `scripts/pi-upstream.ts`                                            |
| No dead code, shims, slop or tests that restate the implementation       | the review team (`reviewer-simplicity`)                             |

Reject slop and jargon; no compatibility shims or speculative fallbacks: move forward and update callers. Commit a test
for a feature's core path and one regression test per bug that happened, exercising behaviour and failure cases rather
than restating the implementation; prove other edge cases once and show the command and its output; one-off migrations
get no test.
