---
name: adopt-ultimate-setup
description: "Ultimate's own repo setup: families, a review team, the lander. Use in onboarding step 5, or to adopt those pieces."
---

# Adopt Ultimate's own setup

Ultimate's repository is built with Ultimate, and its `.ultimate/` is a working example of a project setup. This skill
shows it to the user and copies the pieces they pick into their project, rewritten for that project. Paths below are
relative to the Ultimate clone (`../..` from this skill); read the live files each time, never from memory, since
they change.

## 1. Tour

Read `.ultimate/settings.json` and every file in `.ultimate/agents/`. In one `message {to: 'user', text, questions}`,
explain each piece in one or two plain lines: what it is, why Ultimate has it, and what it would be here. End with one
multi-select question listing the pieces below, plus **None, thanks**.

| Piece              | Ultimate's files                                                                       | Why it exists                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model families     | `settings.json` `modelFamilies` (`lead`, `review`, `fast`)                             | Committed families are the team's default: they apply over the families a machine saved last, while a person's own families for the project win over them; agents name a family, not a model. |
| Review team        | `agents/reviewer-correctness.md`, `reviewer-simplicity.md`, `reviewer-architecture.md` | The shipped `reviewer` starts every `reviewer-*` in parallel and merges one verdict; each has its own focus, on more than one model, so one model's blind spots get caught.                   |
| Coordinator family | `agents/coordinator.md` (an overlay: `addTools: []`, `family: lead`)                   | Branches plan, decide and verify; this repository puts them on a family of its own (`lead`), while `default` stays the baseline a definition without a family follows.                        |
| Lander             | `settings.json` `lander.checks` and `lander.push`                                      | Every landing runs the project's checks on the merged result and pushes; a failure goes back to the submitting branch to fix.                                                                 |
| Worktree setup     | `settings.json` `isolates.worktree.setup`                                              | Each branch works in a fresh worktree without dependencies; setup installs them before the first tool call.                                                                                   |

Not part of the tour, never copied: `extensions.enable` (`voice-live` is a personal choice), `assign.preview` (only for
projects that preview their own extensions), `.ultimate/skills/ultimate-provider-smoke` and `README.md` (both about
Ultimate itself).

## 2. Adapt

Write only the picked pieces into the project's `.ultimate/`, merging into an existing `settings.json` and keeping
files the project already has. Every piece is rewritten for this project: no text about Ultimate's code, conventions,
commands or people may survive.

- **Logins first.** Before naming any model, list the models the user can run (codemode `ultimate.models()`) and use
  only those. Agents name a family (`family:`, keeping their own `thinking` and `fast` where they differ from it);
  the models go in the project's `modelFamilies`, reusing family names the user already has (codemode
  `ultimate.agents()` and the Agents panel show them). A definition keeps `fast: true` only when its family's model is
  one the `fast` extension puts on the priority tier (`fastModels`, OpenAI models), and drops it otherwise. With one
  provider, use different models or thinking levels per reviewer and say the team lost its model diversity.
- **Review team.** Keep each reviewer's frontmatter shape (`tools: [read, bash]`), its fixed-range rules, P0–P3 levels
  and report format. Rewrite its focus: correctness names this project's real risks (from its code, tests and docs)
  instead of durability and replay; simplicity keeps its rules; architecture is rebuilt from the project's own
  `AGENTS.md`, `CLAUDE.md` or architecture docs, naming the project's patterns and where they live. With no such docs,
  offer to skip the architecture reviewer. Never add a `reviewer.md`: it would replace the lead.
- **Coordinator family.** Put the coordinator on a family of its own only when the user wants the coordinator and the
  branches it starts on a model separate from the project's baseline; a coordinator left on `default` is a valid
  choice that adds no preset. Other agents are unaffected either way: a named worker, reviewer or designer keeps the
  family its own definition names, whatever family the coordinator runs on. Take the coordinator family's model from
  what the user can actually run (codemode `ultimate.models()`), chosen by expected cost and quality for the work
  they hand to branches and how hard that work is, not by a fixed ranking; read the live family, model and thinking
  (`ultimate.agents()`, the Agents panel) instead of judging from a role or a family name. The definition names the
  family, not the model, so a later family change moves the coordinator from its next start.
- **Lander.** `checks` are the project's own check and test commands, found in its manifests and CI, in order (an
  array runs as a concurrent group), each with a `timeout`. Add `push` only after the owner says yes, naming the
  remote.
- **Worktree setup.** Follow "Worktree setup" in `skills/integrate-ultimate/SKILL.md` (lockfile install, `.env`,
  database, dev port) and prove it in a scratch worktree as it describes.

## 3. Show and commit

Run `git diff` (and `git status` for new files) on `.ultimate/`, show the user the result in your message, and commit
after they agree. A run of the review team on a recent commit range is a cheap first proof; offer it.
