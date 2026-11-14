Ultimate's system prompt: coding guidelines, project context, skills, and the source reload layers.

Shared sections keep coding policy and durable-operation guidance; agent definitions own task routing and acceptance.
Tool schemas own parameter and matching contracts; shared tool guidance adds lookup/edit workflow, retry and polling
rules without restating those schemas. Guidance follows the conversation's available tools.
Project instructions and skill discovery apply to every capable reader. The disabled-extension catalogue is only
for the standing @ultimate, which owns configuration; branches and children do not receive it. Operational flows
such as onboarding and Dream are read from their owning docs on the matching input, not repeated in every role.

The system prompt stays the same across builds, so a reload of an extension keeps the prompt cache. Instead, the input that starts a
conversation's run gets a `prompt.build` note when the build differs from the one its last run started on: "Build
changed: <old> → <new> · generation N · changed: …". The note is decided in the commit that places the input (the
patched `beforeInput` hook), and the `prompt.build` document records the last build each conversation saw. A new
conversation records its first build silently, and a fork starts from its parent's.

The primary agent (@ultimate) also follows its instructions there. When its definition's
text differs from the conversation's, the hook re-applies it, so a typed input picks up an updated `agents/ultimate.md`
as Messages deliveries already did. The document keeps a hash of each project context file (`AGENTS.md`) and of the
clone's `AGENTS.md`, `docs/*.md` and `agents/*.md`, and the note names the definition re-applied and the files changed
since the last run ("Instructions changed: … · Docs changed: …"). Other agents keep the instructions they started with.

A build note also names what landed: the document keeps the clone's commit each run started on, and the first-parent
commits since then, grouped by the branch that made them (historical `from #N` subjects and
`Ultimate-Conversation` trailers; a subagent under its owner), become "landed: <branch title> (#N), …".
Commits without public IDs are named by their subjects; a reload without commits (a hand edit in the clone) names none.

The transcript shows every note as one quiet divider: "↻ Reloaded · <branch> #N · <branch> #M · +K more" with links to
the branches, else "↻ Reloaded · build a → b" or "↻ Instructions changed · …", its full text on hover. `self`'s
update toast names the landing likewise ("Landed <branch>") when a `workspaces.landed` event comes within a minute
of the page switching to a new web bundle.
