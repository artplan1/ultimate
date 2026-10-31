import { FileFinder } from '@ff-labs/fff-node'
import type { GrepResult, Result, SearchResult as FileSearchResult } from '@ff-labs/fff-node'
import type { SearchResult } from './types.ts'

/** How long an index nobody is searching stays before its native finder is released. */
export const IDLE_MS = 5 * 60_000
/** A first scan that takes longer fails the call instead of searching half an index. */
const SCAN_MS = 30_000
export const DEFAULT_LIMIT = 30
export const MAX_LIMIT = 100
export const DEFAULT_CONTEXT = 2
export const MAX_CONTEXT = 10

/** One `search` call, as the tool accepts it. */
export type SearchRequest = {
  query?: string
  pattern?: string
  glob?: string
  mode?: 'plain' | 'regex'
  context?: number
  limit?: number
}

/** What one validated request runs: a glob listing, a fuzzy path search, or a content search. */
type Plan =
  | { kind: 'files'; call: 'glob' | 'query'; term: string; limit: number }
  | { kind: 'content'; term: string; limit: number; mode: 'plain' | 'regex'; context: number }

/** One indexed working directory; `using` counts the calls holding it, so none is released underneath another. */
type Index = {
  finder: FileFinder
  ready: Promise<void>
  using: number
  failed?: string
  idle?: ReturnType<typeof setTimeout>
}

function plan(request: SearchRequest): Plan {
  const { query, pattern, glob } = request
  if (query !== undefined && pattern !== undefined)
    throw new Error(
      'Pass either query (find files by path) or pattern (search file contents), not both.',
    )
  if (pattern === undefined && (request.mode !== undefined || request.context !== undefined))
    throw new Error('mode and context apply to content search; pass pattern to use them.')
  const limit = Math.min(request.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  // The native search takes a glob as a constraint word in the same string, usable before or after the term.
  if (pattern !== undefined)
    return {
      kind: 'content',
      term: glob ? `${glob} ${pattern}` : pattern,
      limit,
      mode: request.mode ?? 'plain',
      context: Math.min(request.context ?? DEFAULT_CONTEXT, MAX_CONTEXT),
    }
  if (query !== undefined)
    return { kind: 'files', call: 'query', term: glob ? `${glob} ${query}` : query, limit }
  if (glob === undefined)
    throw new Error(
      'Pass query (fuzzy path search), pattern (content search) or glob (file filter or listing).',
    )
  return { kind: 'files', call: 'glob', term: glob, limit }
}

function files(result: Result<FileSearchResult>, limit: number): SearchResult {
  if (!result.ok) throw new Error(`Search failed: ${result.error}`)
  const items = result.value.items.slice(0, limit).map((item) => ({ path: item.relativePath }))
  return {
    kind: 'files',
    items,
    total: result.value.totalMatched,
    more: Math.max(result.value.totalMatched - items.length, 0),
  }
}

function content(result: Result<GrepResult>, limit: number): SearchResult {
  if (!result.ok) throw new Error(`Search failed: ${result.error}`)
  // A regex the engine cannot compile falls back to literal matching; report the error instead of a quiet wrong search.
  if (result.value.regexFallbackError)
    throw new Error(`Invalid regular expression: ${result.value.regexFallbackError}`)
  const shown = result.value.items.slice(0, limit)
  const more = result.value.items.length > shown.length || result.value.nextCursor !== null
  return {
    kind: 'content',
    items: shown.map((match) => ({
      path: match.relativePath,
      line: match.lineNumber,
      text: match.lineContent,
      ...(match.contextBefore?.length ? { before: match.contextBefore } : {}),
      ...(match.contextAfter?.length ? { after: match.contextAfter } : {}),
    })),
    total: shown.length,
    more: more ? 1 : 0,
  }
}

/**
 * The native finders, one per working directory, scanned once and owned by the calls that use them. An unused index
 * is released after `IDLE_MS`; `dispose` releases the rest when the extension unloads, keeping any still in use until
 * its last call finishes. Scans need no frecency or history database, so nothing is written to the searched tree.
 */
export function createIndex() {
  const indexes = new Map<string, Index>()
  let closed = false

  function open(cwd: string): Index {
    const created = FileFinder.create({ basePath: cwd, aiMode: true })
    if (!created.ok) throw new Error(`Cannot index ${cwd}: ${created.error}`)
    const finder = created.value
    const index: Index = { finder, ready: Promise.resolve(), using: 0 }
    index.ready = finder.waitForScan(SCAN_MS).then((scanned) => {
      if (scanned.ok && scanned.value) return
      // A later call may try again; this one fails rather than searching a partial index.
      if (indexes.get(cwd) === index) indexes.delete(cwd)
      index.failed = scanned.ok
        ? `Indexing ${cwd} did not finish within ${SCAN_MS / 1000} s`
        : `Indexing ${cwd} failed: ${scanned.error}`
    })
    return index
  }

  function acquire(cwd: string) {
    const index = indexes.get(cwd) ?? open(cwd)
    indexes.set(cwd, index)
    index.using++
    if (index.idle) clearTimeout(index.idle)
    index.idle = undefined
    return index
  }

  function drop(cwd: string, index: Index) {
    if (index.idle) clearTimeout(index.idle)
    index.idle = undefined
    if (indexes.get(cwd) === index) indexes.delete(cwd)
    index.finder.destroy()
  }

  function release(cwd: string, index: Index) {
    index.using--
    if (index.using > 0) return
    // A failed scan or an unloaded extension drops at once; a cached index waits out its idle time.
    if (closed || indexes.get(cwd) !== index) {
      drop(cwd, index)
      return
    }
    index.idle = setTimeout(() => {
      index.idle = undefined
      if (index.using === 0) drop(cwd, index)
    }, IDLE_MS)
    // An idle index must not keep a short-lived process alive until it evicts.
    index.idle.unref?.()
  }

  return {
    async search(request: SearchRequest, cwd: string): Promise<SearchResult> {
      const wanted = plan(request)
      const index = acquire(cwd)
      try {
        await index.ready
        if (index.failed) throw new Error(index.failed)
        const { finder } = index
        if (wanted.kind === 'content')
          return content(
            finder.grep(wanted.term, {
              mode: wanted.mode,
              pageSize: wanted.limit,
              // One match past the limit proves more exist: the page fills per file, and a file capped at exactly the
              // limit would look complete.
              maxMatchesPerFile: wanted.limit + 1,
              beforeContext: wanted.context,
              afterContext: wanted.context,
            }),
            wanted.limit,
          )
        return files(
          wanted.call === 'glob'
            ? finder.glob(wanted.term, { pageSize: wanted.limit })
            : finder.fileSearch(wanted.term, { pageSize: wanted.limit }),
          wanted.limit,
        )
      } finally {
        release(cwd, index)
      }
    },
    /** Release every index no call is using; an index in use is released when its last call ends. */
    dispose() {
      closed = true
      for (const [cwd, index] of indexes) if (index.using === 0) drop(cwd, index)
    },
  }
}
