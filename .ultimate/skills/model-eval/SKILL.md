---
name: model-eval
description: Compare two configured model families on one frozen real task, with an oracle proven before spending, roles and models verified from the runtime, and the run's causal cost accounted. Use when asked to compare families or models, or to check whether a different family changes an outcome. Not for checking a change on one model (that is ultimate-provider-smoke).
---

# Compare families on one frozen task

A model comparison is an experiment: a subject, an oracle and a bill. This runs one on a real task from this
repository, given to ordinary agents of two configured families, scored by a check the subject cannot see, with the
whole run's cost accounted.

State the limits in any answer: one bounded task cannot rank models. It can show whether a family completed this
task, at what cost and with what divergence. Run it only when the user asked for paid runs and named the families.

## 1. Freeze the task

- Pick a bug that actually happened here: the failing behaviour, what a user saw, and the commit before its fix.
- Freeze it at one commit where the bug reproduces, for every subject, and record that sha: a moving base makes the
  results incomparable. A task whose bug is still open at the current tip fits the normal flow, because a child's
  worktree starts from the owner's tip; a historical bug needs a checkout of the older sha, which nothing does for you.
  In this repository a subject's own checkout is a child with its own worktree (`subagent start` with
  `isolate: worktree`), previewed as that child's workspace (`instance start {subagent: <id>}`); a process-level test
  that a preview cannot run uses the documented scratch server instead (`docs/running.md`).
- Write the brief as the ordinary task a person would give: the symptom, how to reproduce it, what to do ("fix the
  failing …; run the checks that cover it"). No mention of a comparison, no eval names or branch names, no pointer to
  the historical fix, no old solution or prior transcript in the checkout. The subject must not be able to tell that
  it is being measured.
- Keep the oracle outside the subject's reach. It scores from the run's own record, never from a file in the
  subject's checkout.

## 2. Prove the oracle before spending anything

The oracle is the check that decides the run: a test file, a script or a command that fails on the frozen sha and
passes on a correct fix. Both controls run before any subject prompt:

- **Positive:** apply a fix you know is correct (the historical one, or a minimal one you write) and require the
  oracle to pass.
- **Negative:** keep the frozen state, or apply a change that is wrong but plausible, and require it to fail.
- Record both outputs with the command. An oracle that passes on the broken state measures nothing.

Read the exact command, not just its name: which files its include patterns pull in, and what those files touch. A
wildcard can include tests that create or delete a local database or need a service: run them where that is fine, or
exclude those files by name — never ban wildcards to make a suite look offline. The oracle's failure output must name
the bug; a failure from missing dependencies, a missing service or a setup error is infrastructure, and it is fixed
before the run, never reported as a result.

## 3. Decide what is measured, and read it from the runtime

- The unit is a configured family: a model and a thinking level applied to the same roles. Never compare model names
  assembled by hand; two families can share a model, and a family's model can change any day.
- Both subjects run the same roles: the same agent definitions and instructions, the same tools, setup commands and
  task text. The family brings the model and the thinking level, so those differ between subjects — that difference
  is what is measured.
- Put a role on a family either through the project's families, set once for both subjects, or through a private
  additive overlay in that instance's own user home (`<home>/user/.ultimate/agents/<name>.md`, holding `addTools: []`
  and `family: <name>`): an overlay keeps the built-in instructions and raises no replacement warning. Never replace a
  built-in definition to do it — the setup note then asks the agent to repair a profile outside its project.
- Verify from the runtime, not from settings: after a turn, read `pi.agent` (or the trace) for each conversation and
  confirm the provider/model, the thinking level and the roles that actually ran. A subject that silently fell back to
  another model is a different subject, and the result is void.

## 4. Preflight on the running instance, then launch or stop

Before any subject prompt, confirm on the running instance:

- its private home, project path and workspace, and that the workspace is the frozen sha with a clean tree;
- the initial system prompt and the setup notes it carries: which definitions are in effect (overlays, not
  replacements) and whether a warning names a model without a login;
- the tools it has, and the exact setup commands that ran in its checkout;
- that logins and settings come the documented way: a preview reads the real provider logins and seeds its own
  private user config. Never copy `auth.json`, secrets or credentials into it.

Fix or report anything wrong here instead of launching. An instance that starts badly wastes the whole run, and its
result measures the environment, not the family. Its private home and worktree isolate the run's process and state, not
the filesystem: an absolute path outside them reaches the real machine, so check where a subject's writes landed before
scoring anything. Keep the run inside the limit of three instances, and start and stop each preview from the host that
owns its checkout: another host starting it gets a different `ULTIMATE_SOURCE`, home and project locks.

## 5. Run the same prompt and keep the two runs apart

- Send the task text unchanged to both subjects: no hints, no nudges, no corrections. If a subject stops to ask, note
  it — asking can be the outcome.
- Give both the same budget and stop rule, decided before launch (turns, wall clock).
- Set an operational cap on spend before launching and check it between turns: calls already in flight still spend,
  so a cap can overshoot by one turn's work. Report the overshoot when it happens.
- Run nothing else that writes the same state while subjects run; unrelated work in the window makes the cost
  impossible to attribute.

## 6. Score by the oracle, then account for the cost

- Score the oracle only. A fix the subject describes but did not make, a weakened test or a skipped check is a
  failure; a passing check the oracle cannot reproduce is unmeasured, not a win.
- Score scope and safety separately from the oracle. Writing outside its checkout, editing a global profile or copying
  credentials is a failed subject even when every functional check passes: report the two results as two results,
  never as one that cancels the other. This is a report, not a policy to enforce.
- Total the causal cost: the subject's own turns plus the setup, management, acceptance and rework this run needed,
  read per conversation from the usage documents. Label estimates as estimates; catalogue prices are not invoices.
- Report elapsed time separately from money, include only the run's own calls in the causal total, and name any
  unrelated window you left out instead of folding it in.
- One implementation owner per subject is enough: no reviewer chain, report framework or extra agents are needed for
  the comparison itself.

## 7. Read the record, then stop

Read each instance's home before stopping it: a stop removes a temporary home that was not supplied explicitly.

```bash
# Here `sqlite3 -readonly` failed with "unable to open database file" on databases that existed, while the read-only
# node:sqlite driver opened them. If this reader fails on a database too, copy the file with its `-wal` and read the
# copy.
read_db() { # read_db <database> <sql>
  node -e 'const { DatabaseSync } = require("node:sqlite")
const db = new DatabaseSync(process.argv[1], { readOnly: true })
for (const row of db.prepare(process.argv[2]).all()) console.log(JSON.stringify(row))
db.close()' "$1" "$2"
}
read_db <home>/trace.sqlite \
  "select conversation, name, round(ms) as ms, result from calls where kind='model' order by at"
read_db <home>/state.sqlite "select d.kind, r.content from documents d
  join document_revisions r on r.document_id = d.id
  where d.owner_id = <id> and d.kind in ('\"pi.agent\"', '\"pi.usage\"') order by r.seq desc"
```

Preserve what the report needs before stopping — each subject's conversations, usage, trace and final diff — or start
with an explicit `home`, which `instance stop` keeps. Then stop from the owning host, delete or keep the home as
`extensions/instance/README.md` says, and restore any setting you changed only for the run, saying that you did.

## 8. Report

One row per subject, then a short note: the role, the family actually used with the model and thinking read from the
runtime, the oracle's result with its command, causal cost, elapsed time, and how the result differs from the task
("None" when it matches). End with the limits: this task, this repository, this state of the models, no ranking beyond
that.

Show outcomes and the oracle's own output. Leave out private reasoning, prompts, tool payloads and any secret.
