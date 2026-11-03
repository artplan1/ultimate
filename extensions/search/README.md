Find files and search their contents with one read-only tool: `@ff-labs/fff-node` indexes paths and literal text, and ripgrep searches raw regex.

One tool, `search`, over the conversation's working directory:

- `query` finds files by fuzzy path; `pattern` searches contents. Use one or the other.
- `pattern` uses regex when it contains regex syntax and compiles as JavaScript; otherwise it stays literal. Regex runs through `rg`'s default engine, without fff's query-parser rewriting. Expressions that engine rejects (such as lookahead) retry as exact literal text. Content matching uses smart-case: uppercase makes it case-sensitive.
- `glob` limits either search to matching paths, or lists them when it is the only argument. Searches filter by the glob through the native glob listing, so `?`, character classes, braces and spaces in a file path all work. Globs keep the index's own meaning: one without a `/` that starts with `*` matches file names at any depth, any other glob matches the path relative to the working directory, so use `**/` to reach nested files.
- A content pattern cannot contain a newline: the native matcher searches line by line. `context` adds lines around each match (default 2, capped at 10); `limit` bounds the items returned (default 30, capped at 100).

`details` is a `SearchResult` from `types.ts`: `kind` is `files` or `content`, `items` carry a relative `path` and, for content, `line`, `text` and `before`/`after` context, `total` counts matches and `more` counts those beyond the returned page. For files both are exact. For content `total` is the number returned, and `more` is 1 only after the search actually found one further match — never inferred from unscanned files. A full content total would mean scanning every file on every search. The tool text says the same in words (`n more files`, `more matches than shown`).

## Regex prerequisite

Install ripgrep (`rg`) on `PATH` in the environment running Ultimate, for example `brew install ripgrep` on macOS. A missing executable fails regex search with an installation hint; literal and file searches still work. Regex uses rg's default ignore rules, skips binary files and files over 10 MB, and ignores user rg configuration. An optional `glob` still filters results through fff's glob listing. Results stream until one further match is proven and the last visible match has its context; the tool then stops rg. Regex searches do not use the native index for content matching or promise its result order.

## Index lifecycle

`search.ts` keeps one native `FileFinder` per working directory, created on first use and scanned once before searching; a scan that does not finish within 30 seconds fails the call instead of searching a partial index. Each call holds its index while it runs, so a release never destroys a finder another call is using. An index with no calls left is released after five idle minutes, and unloading or reloading the extension releases the rest, keeping any index still in use until its last call ends. A conversation that changes its working directory gets its own index; the previous one falls idle and is released.

Search is read-only: finders are created without frecency or history databases and `trackQuery` is never called, so nothing is written to the project or the user's home, and a read-only agent (scout, reviewer, a dream pass) can search safely. The index follows file-system changes, so files created during a conversation are found without an explicit rescan. A glob filter reads its matching paths from that same index, so a filter over an enormous tree costs one listing of its matches in memory.

The native binary comes from the platform package of `@ff-labs/fff-node` 0.11.0, pinned exactly in `package.json`; it supports macOS, Linux and Windows on x64 and arm64. On a platform without a binary, `FileFinder.create` throws and the tool returns that error.

`test/search.test.ts` covers native file/glob/literal search, validation, limits, counts and index lifecycle in-process. `test/e2e/search.test.ts` runs real rg for raw regex, whitespace/path-parser regressions, literal retry, glob filtering, limits and context.
