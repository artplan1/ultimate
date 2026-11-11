# Papercuts

Small frictions recorded the moment an agent hits them, so the next dream finds them instead of searching for them:
a tool that failed or needed a workaround, an instruction that misled, a harness or environment limitation, a model
mistake worth knowing, something slow enough to cost time.

An agent raises one with `papercut {what, kind, where?, fix?}`, reads the open ones with `list`, and closes them with
`{action: 'resolve', id, how, ref?}` once they are fixed, noise or superseded; `ref` names the commit or memory slug
that fixed it. A repeat of the same `kind` and `where` counts up on the open row rather than adding one (without a
`where`, the first words of `what` stand in for it), so twenty branches hitting the same wall leave one row with a
`count`. Text is one line each: 280 characters of `what`, 120 of `where`, 200 of `fix`. Nothing writes here
automatically, the same as memory.

The tool call stays as the durable evidence: the row says `#conversation`, `at`, `by` (the raiser's label, or a
standing or child agent's `@name`) and `cwd`. Rows live in the `papercut` document on the root conversation, newest
100 kept; when the cap drops an oldest row, the tool says so, and its conversation entry still has it.

## Where the dream reads it

`extensions/dream/DREAM.md`'s failures pass starts from the `list` action rather than a search over every entry, which
is exactly the cost this tool exists to avoid: `ultimate.action('papercut', 'list')` returns `{ text, rows }`, the
same compact text the tool gives. Each row is a pointer to verify, not a verdict, and the pass proposes closing rows
open over 30 days without a repeat.

The document lives with the chapter: after "Fall asleep" the next chapter's root gets its own, so the pass (and
@ultimate's `prepare` handover) name the rows still open instead of assuming they carry across. Conversation entries
stay readable there through codemode's `chapter` option.
