---
name: ultimate-changelog
description: Use when the "Ultimate changelog" automation fires, or when asked what is new upstream in Ultimate. Reads the public feed, checks each entry's commits against this clone, proposes merges or cherry-picks, changes nothing.
---

# Ultimate changelog

The user runs a modified copy of Ultimate. This skill tells them what landed upstream since they last looked, and what
of it is worth bringing in. Read only public data: `danielgriesser.com` and GitHub. Change nothing without their yes.

## 1. Read the feed and pick the entries

Fetch `https://danielgriesser.com/ultimate/changelog/feed.json`. `entries` is newest first; each has `id`, `url`,
`title`, `date`, `kind`, `text`, and often `commits` (full SHAs) and `media` (images or a video with a `poster`).

- When the "Ultimate changelog" automation fired, take the entries its message names.
- When the user asked what is new, take the entries they ask about; with no range given, the newest few, and say which.
- A failed fetch is not an error worth reporting loudly: say the feed did not answer and stop.

## 2. Find the upstream remote in the clone

Work in the Ultimate clone the user runs (its path is in the system prompt). Find the remote pointing at
`github.com/HazAT/ultimate`:

```bash
git remote -v
```

If none does and the user's `origin` is a fork, add it as `upstream` and say so once:

```bash
git remote add upstream https://github.com/HazAT/ultimate.git
git fetch upstream
```

Otherwise `git fetch` the remote you found.

## 3. Check every commit against what the user already has

For each entry's `commits`, the commit is already in the user's branch when either holds:

```bash
git merge-base --is-ancestor <sha> HEAD       # exit 0 → it is in
git cherry HEAD <sha> <sha>^                  # a leading "-" → a cherry-picked copy is in
```

Skip entries that are fully in. Say plainly how many you skipped and why.

## 4. Say what each remaining entry is worth

For every entry that is not in, a few lines:

- **What it is**, in plain words a person can act on, not the changelog's marketing.
- **Whether it is worth taking**, given what the user changed in their copy: read `git log` in the areas the entry
  touches and check whether their own work already covers it or would collide with it.
- **Merge or cherry-pick**, with the exact commits: a merge commit needs `-m 1`
  (`git cherry-pick -m 1 <merge>`); a linear commit cherry-picks directly.
- **Whether it applies cleanly**, without touching anything:

```bash
git merge-tree --write-tree --merge-base=<sha>^ HEAD <sha>
```

Conflicts it names are what the user will have to decide; name them.

If the clone tracks `HazAT/ultimate` directly and has no changes of its own, say that Ultimate's own update in the
status line brings everything in, and that nothing here needs doing by hand.

## 5. Show the screenshots

For an entry with `media`, download its first image into a temporary folder with `curl` and open it with the read tool
so it is in context; for a video, use its `poster`. Then send that entry's suggestion as its own `message` to the user
with `images: "latest"`, and in the text: its `url`, a link for each commit
(`https://github.com/HazAT/ultimate/commit/<sha>`), and links to any other media. One message per entry — never one
long digest.

## 6. Ask, then build only what they pick

Reading the feed and reporting it changes nothing: never merge, cherry-pick, edit or push in the clone on your own,
and a feed notification is not a request to integrate. The clone still moves forward the way it already does,
by Ultimate's own update fast-forwarding it; a merge or cherry-pick happens only for what the user picks here.

The last message asks with one `questions` card which entries to take; for the ones they pick, start a branch in the
existing clone — reuse this checkout, add a worktree only with explicit permission, and no reset:

- **Freeze what you evaluated.** Read the upstream ref once when the branch starts and keep its sha in the brief;
  the feed entry's `commits` are the record of what you checked. A later `git fetch` moving that ref does not add
  work to this branch: re-read and say so when they ask for newer.
- **Keep the clone's own state.** Other writers' uncommitted changes are theirs: name them and work around them,
  never stash, reset, check out over or format them. Bring the commits in (cherry-pick, or a merge commit with
  `-m 1`) and keep the fork's own behaviour — `.ultimate/`, prompts, agent definitions, docs — rather than merging it
  away. A real conflict between upstream and that behaviour is the user's decision to make.
- **Run the checks with exact paths and full output.** The clone's declared `pnpm check`, then the owning test
  directories or files the change actually touches (`pnpm test extensions/<name>/`), with the whole log kept. Never
  a broad filter such as `test test/`, and never only the last lines of a failing run. A check that refuses over
  unstaged deletions is an honest blocker until the user approves staging them, not a reason to weaken the check.
- **Align dependencies when the lock moves.** A merge that changes `package.json` or `pnpm-lock.yaml` gets the
  matching frozen install before the checks run; a stale installed set fails in ways that blame the wrong commit.
  In a checkout whose `node_modules` is a symlink into another clone, first prove the installed lock equals the
  checked-in one (`shasum -a 256 node_modules/.pnpm/lock.yaml pnpm-lock.yaml`), then run the commands as
  `pnpm --config.verify-deps-before-run=false …`, which stops pnpm purging the shared folder, with a temporary
  excludes file holding `/node_modules` given to Git through its environment so the `git` the check runs itself sees
  it (`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.excludesFile GIT_CONFIG_VALUE_0=<temp file> …`), rather than editing
  the shared `.git/info/exclude`. A mismatch, or an install that is genuinely needed, means a real install — never a
  bypass.
- **Separate the approvals.** Their yes to taking the commits is not a yes to restart the host or the supervisor:
  Git delivery (commit, land, push as configured) and each process restart are asked for separately, for one exact
  action and clone.

Entries they leave out stay out until they ask again.
