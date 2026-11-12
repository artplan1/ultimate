## Working in a git worktree

Run `git worktree add ../ultimate-preview -b preview`, then `cd ../ultimate-preview`, `pnpm install`, and `pnpm start --no-open` to run that worktree's code. Each project path gets its own default state home (a hash of the path), storage and supervisor locks, first free port from 4747, and Vite cache inside its home; explicit home or port overrides must remain distinct. The global `ultimate` command runs the clone it was linked from, so use `pnpm start` inside the worktree instead.

Start a subagent with `isolate: "worktree"` (the worker default) to give its tools a separate checkout; verify its commits, then `land` them or `discard` the checkout while keeping its branch. For Ultimate itself, `instance start` with `subagent: <child id>` previews that child's code on a free port with a separate temporary home; stop the preview afterwards.

### Main-agent final integration

Coordinator branches started by @ultimate are isolated in their own worktrees by default: under `<home>/worktrees`, or
where the project's `isolates.worktree.path` says, made by its `add` and `remove` commands when set
(`extensions/workspaces/README.md`). A branch started in a subfolder of the repository works in that subfolder. A project
outside Git — its repositories only in subfolders — has no checkout to isolate, so its branches run in the shared folder.
`workspace status` shows its tip and the original checkout's tip.
Read worker reports and diffs; rerun checks only for missing or thin evidence, reported failures, changes crossing
workers, `server/` or `shared/` changes, or surprises in the diff, then land and call `workspace submit`.
The lander is the final gate and the only way to main: code, no model. It runs the source project's `lander.checks` on
the merged result (here `pnpm check` alone: the suites belong to the branches that change them), a failing check once
more, then fast-forwards the target branch and, when `lander.push` is set, pushes it, so keep working while it runs.
A conflict or a check that failed twice comes back to the submitter as a waking report: fix it in the workspace (a
flaky test at its cause, or delete it) and submit again. A landing is the end of the branch's work: its report is a
note in the branch, the branch is concluded unless work is still under way (a subagent, a reply it waits for, queued
input), whoever started it wakes with the landing card, and the concluded branch's checkout is freed.
Its progress shows live on the submit tool card, with expandable steps, and its report as an outcome card; the
source's @lander conversation, pinned in the sidebar's agents group, keeps the full log and takes no input.
For `server/`, `shared/`, `patches/` or `pnpm-lock.yaml` changes, an authorized `restart` works once the running clone is clean at the landed commit.

### Landing and pushing

The top-level agent changes files and runs the checks covering them, then stops and hands the working tree over: the
user's approval of that handoff is what lets it commit and `workspace submit`. It may then push the destination branch
(normally `main`) to this repository's GitHub remote, `origin` (`HazAT/ultimate`), public or private; other repositories
stay out of it. `workspace submit` goes as far as the account allows: the lander pushes after its checks only when
`lander.push` is set, and `lander.push` is unset here because the account has pull-only access to `origin`, so landings
stay local and report "Not pushed." Subagents commit and report; only the top-level agent submits.

Use normal, non-force pushes only. Remote advancement or a non-fast-forward rejection is normal: fetch, inspect the
incoming log and diff, and merge non-destructively in an isolated workspace, preserving both histories. Rerun checks,
then land and push normally, within that approval. Stop and report ambiguous conflicts,
failing checks, security concerns, or a situation requiring a force push or history rewrite—not ordinary remote
advancement. Do not push secrets or unrelated unverified work.
This does not authorize releases, publishing, deployments, or GitHub issue/PR changes.
