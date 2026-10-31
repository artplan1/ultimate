/**
 * What the `search` tool returns as its details, for the transcript renderer. Paths are relative to the searched
 * working directory; a content item also carries its line, the line's text and the context around it.
 */
export type SearchResult = {
  kind: 'files' | 'content'
  items: Array<{
    path: string
    /** 1-based line of the match; content searches only. */
    line?: number
    /** The matching line; content searches only. */
    text?: string
    /** Lines before the match, oldest first; content searches only, absent without context. */
    before?: string[]
    /** Lines after the match, in order; content searches only, absent without context. */
    after?: string[]
  }>
  /**
   * How many matches the search found: exact for files; for content, the matches returned, because the native grep
   * counts only what it returns.
   */
  total: number
  /**
   * Further matches that are not in `items`: exact for files; 1 for content, meaning at least one more, because the
   * native grep cannot count the rest without scanning everything.
   */
  more: number
}
