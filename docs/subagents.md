## Subagents

Definitions with `resident: true` have one standing conversation per project, reached by the subagents service and pinned in the sidebar's agents group; deferred tools explicitly named in a definition are offered only to conversations configured from it.

A `watchdog.failure` card reports a child's provider failure, with its error and last step; temporary errors get one automatic retry first. Check the child before resuming it with a message, or ask @ultimate when the user must act. A successful retry's answer arrives as a normal subagent report.

Use `subagent` to delegate bounded research, recon, review, or isolated implementation; verify the results. Foreground calls return the child's answer or yield on queued steering while it continues running. All new children survive the parent's stop; use explicit child stop, which lists files left uncommitted in the child's worktree. Undelivered answers, including the answer to a one-way `message` the parent sent the child, steer the active run at its next tool-round boundary, or start a run when idle. Start, message/steer, wait, stop, and list all use child conversation IDs. Children cannot delegate by default. Only definitions explicitly listing `subagent` in `tools` retain the tool and
extension, subject to the parent's tool subset. Coordinator behaviour lives in `agents/coordinator.md`.

Definitions live in `agents/`, `~/.ultimate/agents/`, and the project root's `.ultimate/agents/` (later wins by name; a later file marked by `addTools`, an overlay, extends the earlier one instead: it may override any setting such as `model` or `thinking`, adds tools with `addTools`, adds denied tools with `denyTools` and appends its body, but never replaces the instructions or the `tools` list), and are reread at every start; the Agents panel lists them under the model family each runs on. `tools` is an optional YAML list selecting the parent's tools; omitted, it inherits them. `denyTools` is a YAML list of strings removed from either that explicit list or inherited tools; overlays add their entries to the base deny list, and unknown tool names are silently ignored. `summaries: false` turns off the automatic summary model for every conversation the definition configures (no generated title, sidebar summary, reply activity, spawn refresh or abstract; explicit `askSummaryModel` calls still work), as standing agents, the lander and side chats are: use it for agents whose conversations are temporary or keep a fixed title. See `extensions/subagents/README.md` for frontmatter. Shipped definitions name a model family instead of a model (`family: fast`; see "Model families" in `extensions/models/README.md`): `ultimate` and `coordinator` default, `reviewer` review, `worker` and `dream-pass` fast, `scout`, `watcher` and `voice` tiny, `designer` design. A definition's own `model` pins it to one model; moving an agent to another family in the Agents panel saves its definition (an overlay for a built-in).

Review goes through one `reviewer`. When any `reviewer-*` definition exists, the shipped reviewer leads them: it starts
every one in parallel and returns one merged verdict; otherwise it reviews alone. Add a reviewer by adding a
`reviewer-<name>.md`; here `.ultimate/agents/` has three.

### Reviewing uncommitted changes

An immutable `base..head` range remains the default. Missing a range does not select working-tree review. When a
separate review context is justified and pre-review commits are not authorized, request the alternative explicitly:

```text
Review mode: working-tree
Repository cwd: /absolute/path/to/my-app
Expected HEAD: <full commit SHA>
Snapshot scope: <explicit files, including relevant untracked files, or bounded paths to enumerate>
Acceptance criteria: <observable requirements>
```

The reviewer verifies cwd and HEAD and captures a read-only snapshot before inspection and again immediately before
its verdict. Its identity includes the scoped changed file list (tracked and untracked), staged and unstaged diffs
(disable external diff and text conversion), and SHA-256 digests of the changed files' contents, with deletions,
executable modes and symlink targets recorded. Do not follow symlinks outside scope. Use existing Git and digest
tools, not a saved copy, temporary project or new harness. Both staged and unstaged changes and untracked contents
must be reviewed. Do not scan unrelated files, secrets (`.env`, credentials), dependency trees or generated output;
if excluded material is necessary to judge the change, verification is blocked rather than silently incomplete.

A different HEAD, scoped file list, diff or content at the final capture invalidates the review: return
NEEDS CHANGES with verification blocked, not approval of the old or replacement snapshot. Matching captures cannot
detect intervening edits that were reverted; report that limit. Unchanged files may be read for context, so the
identity is not a frozen copy of all dependencies or the whole repository.

The report uses the existing verdict/findings format, replacing `Reviewed range` with `Reviewed working tree`:
absolute cwd, actual HEAD, snapshot identity (digest method and hashes), reviewed paths including untracked files,
exclusions and verification limits. No edits, formatters, mutation-capable tests, staging, commits or pushes are
permitted. This mode grants no delivery authority.

A team lead passes the explicit request and snapshot contract to every leaf, checks that each reviewed the same
identity at start and end, and rechecks it before merging verdicts. A leaf that rejects the mode or omits snapshot
evidence blocks verification. Custom `reviewer-*` definitions must explicitly support this contract; forwarding a
request does not override an immutable-range-only definition. Check discovery for user/project replacements before
assuming a built-in prompt change applies. Definitions reload on next use; no server restart is needed.
