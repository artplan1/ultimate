---
name: ultimate-landing-smoke
description: 'Check the running Ultimate host after a landing card arrives, before reporting the landing as live: the clone is on the landed sha and clean, what the landing needs of the running process is named with its exact approval, the host is healthy afterwards, and one read proves the landed behaviour. Use after every landing on this repository, by @ultimate or any agent reporting one.'
---

# Smoke-check a landing

The landing card says what was merged; it does not prove the host runs it. Read it back, then report only what you
read back: the sha, what reloaded or restarted, the errors, the models, the proof.

## Steps

1. **Git delivery:** the host clone (`ultimate.system()`'s `code.ultimateRoot`) is on the card's sha and not dirty
   (`git log --oneline -1`, `git status --short`). Another person's uncommitted file is theirs: name it, never stash,
   reset or check out over it.
2. **What the landing needs of the process.** Git delivery is not a running host. A change to
   `web/`, a `web.tsx`, `extensions/`, `agents/`, skills or docs reloads on its own in about two seconds. A change to
   `server/`, `shared/`, `patches/` or `pnpm-lock.yaml` needs a fresh core, which is the `restart` tool and needs the
   user's approval for this clone and this moment. A change to `bin/` needs a fresh supervisor: only a human
   `pnpm start` gives one, a core swap does not replace it, so a landing that touches both needs the supervisor
   restart alone. Judge that by the supervisor process itself — its pid and start time — not by the core's
   generation. Ask for the one restart you concluded, and no other.
3. **Preview owners before asking.** A restart or a supervisor restart stops every preview. List the running
   instances and busy branches, and `note` each preview's `conversationId` before the restart, not after it.
4. **Health:** say which core is serving — `process.pid`, `process.startedAt`, and `code.coreStale`, which the host
   sets once `server/` or `shared/` changes on disk under a running core — and which supervisor owns it. A `web/` or
   `web.tsx` change shows as a new `system.web.id`; a server-only extension, an agent definition, a skill or a doc
   has no counter at all, so it is proved by the read in step 5. In every case the bundle left no file out
   (`system.web.left`) and raised no error (`system.web.error`), no extension has a load error, and Claude Code earns
   a line only when its extension is enabled and a family or a pin actually runs a `claude-code/` model
   (`f.model ?? f.follows`). Your own model is the identity you expect: `pi.agent`'s provider, model id and
   `thinkingLevel`.
5. **Feature proof:** one read that shows the landed behaviour itself: the file on main, a document, an action's
   result, the served bundle, a screenshot. Never the card's word alone. A check you could not run is reported as
   skipped.

## One snippet

Run it in codemode; it does steps 1 to 4 read-only and returns one small object. Add the feature proof by hand.

```js
const sh = async (command) => (await tools.bash({ command })).trim()
const sys = await ultimate.system()
const families = await ultimate.action('models', 'families')
const claudeCodeUsed =
  sys.extensions.some((e) => e.name === 'claude-code' && e.enabled) &&
  [
    ...families.families.map((f) => f.model ?? f.follows),
    ...families.users.map((u) => u.pinned),
  ].some((m) => m?.startsWith('claude-code/'))
return {
  git: {
    root: sys.code.ultimateRoot,
    branch: sys.code.branch,
    sha: sys.code.sha,
    dirty: sys.code.dirty,
    log: await sh(`cd ${sys.code.ultimateRoot} && git log --oneline -1 && git status --short`),
  },
  core: {
    pid: sys.process.pid,
    startedAt: sys.process.startedAt,
    stale: sys.code.coreStale,
  },
  supervisor: await sh(
    `ps -o pid=,lstart=,command= -p $(ps -o ppid= -p ${sys.process.pid}) | cut -c1-140`,
  ),
  web: {
    id: sys.web.id,
    at: sys.web.building ? 'building' : sys.build.at,
    left: sys.web.left ?? null,
    error: sys.web.error ?? null,
  },
  extensionErrors: [
    ...sys.extensions.filter((e) => e.server?.error).map((e) => `${e.name}: ${e.server.error}`),
    ...sys.extensionDiagnostics,
  ],
  claudeCode: claudeCodeUsed
    ? JSON.parse(
        await sh(
          `curl -s ${sys.process.url}/api/models | jq -c '{configured: ([.providers[] | select(.id=="claude-code") | .status.configured] | first), models: [.models[] | select(.provider=="claude-code")] | length}'`,
        ),
      )
    : 'not enabled or unused here',
  agent: (await ultimate.doc('pi.agent')).model,
  thinking: (await ultimate.doc('pi.agent')).thinkingLevel,
  previews: (await ultimate.action('instance', 'list'))
    .filter((i) => i.running)
    .map((i) => `${i.url} #${i.conversationId}`),
  busy: (await ultimate.conversations())
    .filter((c) => c.busy && !c.concluded)
    .map((c) => `#${c.id} ${c.title ?? ''}`),
}
```

`ultimate.system()` gives the clone with its `code.sha`, `dirty` and `coreStale`, the serving core's pid and start
time, the web bundle's id, and `process.url` for host reads; the `ps` line shows the supervisor process that owns the
core and when it started. `/api/models` is large, so it stays inside `jq` and out of your context. Run the snippet
before asking for a restart (previews and busy branches) and again once the host runs the landed code (core,
supervisor and health).

## Report

The landed sha, which of the four kinds of change it was and whether that happened, the health line (core pid and
start, supervisor, bundle and extension errors, model identity, thinking), the feature proof, and anything unverified
named as such.
