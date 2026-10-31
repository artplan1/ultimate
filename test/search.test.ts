import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileFinder } from '@ff-labs/fff-node'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { afterEach, expect, it, vi } from 'vitest'
import search from '../extensions/search/server.ts'
import { IDLE_MS } from '../extensions/search/search.ts'
import type { SearchResult } from '../extensions/search/types.ts'
import { context } from '../server/harness.ts'
import { removeTemp, temp } from './helpers.ts'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await removeTemp(root)
  vi.restoreAllMocks()
})

async function fixture() {
  const root = await temp('ultimate-search-')
  roots.push(root)
  const extension = search({
    projectRoot: root,
    onClose: (cleanup: () => Promise<void>) => void closers.push(cleanup),
  })
  const tool = extension.tools!.find((candidate) => candidate.name === 'search')!
  const run = async (args: unknown, cwd = root) => {
    const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args
    let detail: SearchResult | undefined
    const result = await tool.execute(
      prepared,
      {
        env: new NodeExecutionEnv({ cwd }),
        details: async (value: SearchResult) => void (detail = value),
        agent: async () => ({}),
      } as never,
      context,
    )
    const output = (result.output ?? []) as Array<{ type: string; text: string }>
    return {
      details: detail!,
      text: output.map((part) => part.text).join('\n'),
    }
  }
  return { root, run }
}

it('finds files by fuzzy path, lists by glob and searches contents with context', async () => {
  const { root, run } = await fixture()
  await mkdir(join(root, 'src'))
  await writeFile(
    join(root, 'src', 'runner.ts'),
    'import { start } from "./start"\nconst ready = true\nexport function runWorkflow() {}\n',
  )
  await writeFile(join(root, 'src', 'start.ts'), 'export const start = 1\n')
  await writeFile(join(root, 'README.md'), '# Docs\n')

  const found = await run({ query: 'runner' })
  expect(found.details).toEqual({
    kind: 'files',
    items: [{ path: 'src/runner.ts' }],
    total: 1,
    more: 0,
  })
  expect(found.text).toBe('Found 1 file:\nsrc/runner.ts')

  const listed = await run({ glob: '**/*.ts' })
  expect(listed.details.kind).toBe('files')
  expect(listed.details.total).toBe(2)
  expect(listed.details.items.map((item) => item.path).toSorted()).toEqual([
    'src/runner.ts',
    'src/start.ts',
  ])

  const matches = await run({ pattern: 'runWorkflow' })
  expect(matches.details).toEqual({
    kind: 'content',
    items: [
      {
        path: 'src/runner.ts',
        line: 3,
        text: 'export function runWorkflow() {}',
        before: ['import { start } from "./start"', 'const ready = true'],
      },
    ],
    total: 1,
    more: 0,
  })
  expect(matches.text).toContain('src/runner.ts:3: export function runWorkflow() {}')
  expect(matches.text).toContain('src/runner.ts:1: import { start } from "./start"')
})

it('searches a literal pattern the native query parser would rewrite', async () => {
  const { root, run } = await fixture()
  await mkdir(join(root, 'src'))
  await writeFile(
    join(root, 'src', 'notes.ts'),
    'foo  bar\n*.ts TODO literal\nconst x = arr[0] ? a : b\n',
  )

  const spaced = await run({ pattern: 'foo  bar', context: 0 })
  expect(spaced.details.items).toEqual([{ path: 'src/notes.ts', line: 1, text: 'foo  bar' }])
  // The query parser collapses runs of whitespace, so the single space must match nothing here.
  expect((await run({ pattern: 'foo bar', context: 0 })).details.items).toEqual([])

  const globChars = await run({ pattern: '*.ts TODO' })
  expect(globChars.details.items.map((item) => item.line)).toEqual([2])
  const classes = await run({ pattern: 'arr[0] ?' })
  expect(classes.details.items.map((item) => item.line)).toEqual([3])
})

it('filters content by the native glob listing', async () => {
  const { root, run } = await fixture()
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'a dir'))
  for (const path of [
    'src/runner1.ts',
    'src/runner2.ts',
    'src/x.ts',
    'other.md',
    'a dir/file one.ts',
    'runner3.ts',
  ])
    await writeFile(join(root, path), 'hello world\n')

  // A glob without a slash matches at the top level only, so the nested files need **/.
  const top = await run({ glob: 'runner?.ts', pattern: 'hello world' })
  expect(top.details.items).toEqual([{ path: 'runner3.ts', line: 1, text: 'hello world' }])
  const patterns = await run({ glob: '**/runner?.ts', pattern: 'hello world' })
  expect(patterns.details.items.map((item) => item.path).toSorted()).toEqual([
    'runner3.ts',
    'src/runner1.ts',
    'src/runner2.ts',
  ])
  const classes = await run({ glob: '**/[rx]*.ts', pattern: 'hello' })
  expect(classes.details.items.map((item) => item.path).toSorted()).toEqual([
    'runner3.ts',
    'src/runner1.ts',
    'src/runner2.ts',
    'src/x.ts',
  ])
  const spaced = await run({ glob: 'a dir/*.ts', pattern: 'hello' })
  expect(spaced.details.items).toEqual([
    { path: 'a dir/file one.ts', line: 1, text: 'hello world' },
  ])

  // The same glob lists files on its own, so it keeps its native meaning outside a content search too.
  expect((await run({ glob: 'a dir/*.ts' })).details.items).toEqual([{ path: 'a dir/file one.ts' }])
  const empty = await run({ glob: 'src/*.md', pattern: 'hello' })
  expect(empty.details).toEqual({ kind: 'content', items: [], total: 0, more: 0 })
  expect(empty.text).toBe('No matches.')
})

it('rejects requests the native engine cannot answer honestly', async () => {
  const { root, run } = await fixture()
  await writeFile(join(root, 'a.ts'), 'hello\n')
  await expect(run({ query: 'a', pattern: 'b' })).rejects.toThrow(
    'either query (find files by path) or pattern',
  )
  await expect(run({})).rejects.toThrow('Pass query (fuzzy path search)')
  await expect(run({ query: 'a', context: 1 })).rejects.toThrow(
    'mode and context apply to content search',
  )
  await expect(run({ mode: 'plain' })).rejects.toThrow('mode and context apply to content search')
  await expect(run({ pattern: 'a.b', mode: 'regex' })).rejects.toThrow(
    'no raw regular-expression search',
  )
  await expect(run({ pattern: 'a\nb' })).rejects.toThrow('cannot contain a newline')
  await expect(run({ query: 'a', glob: 'a dir/*.ts' })).rejects.toThrow('contains whitespace')
  await expect(run({ query: 'a', glob: '!runner*' })).rejects.toThrow('an exclusion')
  await expect(run({ query: 'a', glob: 'package.json' })).rejects.toThrow('has no wildcard')
})

it('bounds file items by limit', async () => {
  const { root, run } = await fixture()
  await mkdir(join(root, 'many'))
  for (let index = 0; index < 6; index++) await writeFile(join(root, 'many', `item${index}.ts`), '')
  const listed = await run({ glob: 'many/*.ts', limit: 2 })
  expect(listed.details.items).toHaveLength(2)
  expect(listed.details.total).toBe(6)
  expect(listed.details.more).toBe(4)
  expect(listed.text).toContain('Found 6 files, showing 2:')
  expect(listed.text).toContain('4 more files; raise limit or narrow the glob.')
})

it('caps context and reports only further matches it found', async () => {
  const { root, run } = await fixture()
  await mkdir(join(root, 'lines'))
  await writeFile(
    join(root, 'lines', 'many.ts'),
    Array.from({ length: 12 }, (_, index) => `hit ${index}`).join('\n') + '\n',
  )
  const matches = await run({ glob: 'lines/*.ts', pattern: 'hit', limit: 3, context: 0 })
  expect(matches.details.items).toHaveLength(3)
  expect(matches.details.total).toBe(3)
  expect(matches.details.more).toBe(1)
  expect(matches.text).toContain('More matches than shown')

  const capped = await run({ glob: 'lines/*.ts', pattern: 'hit 11', context: 99 })
  expect(capped.details.items[0].before).toHaveLength(10)
})

it('does not claim a match the native cursor only implies', async () => {
  const { root, run } = await fixture()
  await mkdir(join(root, 'aaa'))
  await writeFile(join(root, 'aaa', 'aaa.ts'), 'hit one\n')
  await writeFile(join(root, 'aaa', 'aab.ts'), 'hit two\n')
  for (let index = 0; index < 400; index++)
    await writeFile(join(root, 'aaa', `zzz${index}.ts`), 'nothing\n')
  // Exactly the limit of matches: a page sized to the limit would still report unscanned files, so the count could
  // only be a guess. The extra row asked for here confirms there is none.
  const settled = await run({ pattern: 'hit', limit: 2, context: 0 })
  expect(settled.details.items).toHaveLength(2)
  expect(settled.details.total).toBe(2)
  expect(settled.details.more).toBe(0)
  expect(settled.text).not.toContain('More matches')
})

it('counts a further match only when the glob keeps it', async () => {
  const { root, run } = await fixture()
  await mkdir(join(root, 'keep'))
  await writeFile(join(root, 'noise.ts'), 'needle\n'.repeat(5))
  await writeFile(join(root, 'keep', 'a.ts'), 'needle\n'.repeat(2))
  await writeFile(join(root, 'keep', 'b.ts'), 'needle\n')

  // Five matches from noise.ts fill a native page, but none passes the glob, so nothing is left to report.
  const kept = await run({ glob: 'keep/a.ts', pattern: 'needle', limit: 2, context: 0 })
  expect(kept.details.items).toEqual([
    { path: 'keep/a.ts', line: 1, text: 'needle' },
    { path: 'keep/a.ts', line: 2, text: 'needle' },
  ])
  expect(kept.details.more).toBe(0)
  expect(kept.text).not.toContain('More matches')

  const more = await run({ glob: 'keep/*.ts', pattern: 'needle', limit: 2 })
  expect(more.details.items).toHaveLength(2)
  expect(more.details.more).toBe(1)
  expect(more.text).toContain('More matches than shown')
})

it('scans a working directory once and never releases an index another call holds', async () => {
  const { root, run } = await fixture()
  await writeFile(join(root, 'a.ts'), 'hello\n')
  const create = vi.spyOn(FileFinder, 'create')
  const destroy = vi.spyOn(FileFinder.prototype, 'destroy')

  const [files, content] = await Promise.all([run({ query: 'a.ts' }), run({ pattern: 'hello' })])
  expect(files.details.items).toEqual([{ path: 'a.ts' }])
  expect(content.details.items).toEqual([{ path: 'a.ts', line: 1, text: 'hello' }])
  expect(create).toHaveBeenCalledTimes(1)
  expect(destroy).not.toHaveBeenCalled()

  await run({ query: 'a.ts' })
  expect(create).toHaveBeenCalledTimes(1)
  expect(destroy).not.toHaveBeenCalled()
})

it('indexes each working directory separately', async () => {
  const { root, run } = await fixture()
  const other = await temp('ultimate-search-other-')
  roots.push(other)
  await writeFile(join(root, 'one.ts'), 'alpha\n')
  await writeFile(join(other, 'two.ts'), 'alpha\n')
  const create = vi.spyOn(FileFinder, 'create')

  expect((await run({ query: 'one' })).details.items).toEqual([{ path: 'one.ts' }])
  expect((await run({ query: 'two' }, other)).details.items).toEqual([{ path: 'two.ts' }])
  expect(create).toHaveBeenCalledTimes(2)
  expect((await run({ query: 'one' })).details.items).toEqual([{ path: 'one.ts' }])
  expect(create).toHaveBeenCalledTimes(2)
})

it('releases an index after five idle minutes', async () => {
  const { root, run } = await fixture()
  await writeFile(join(root, 'a.ts'), 'hello\n')
  const create = vi.spyOn(FileFinder, 'create')
  const destroy = vi.spyOn(FileFinder.prototype, 'destroy')
  await run({ query: 'a.ts' })
  expect(create).toHaveBeenCalledTimes(1)
  expect(destroy).not.toHaveBeenCalled()

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // A cached search only reads the index, so no scan needs the faked clock; its release schedules the idle timer.
  await run({ query: 'a.ts' })
  expect(destroy).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
  expect(destroy).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(destroy).toHaveBeenCalledTimes(1)

  vi.useRealTimers()
  await run({ query: 'a.ts' })
  expect(create).toHaveBeenCalledTimes(2)
})

it('releases its indexes when the extension unloads', async () => {
  const { root, run } = await fixture()
  await writeFile(join(root, 'a.ts'), 'hello\n')
  const destroy = vi.spyOn(FileFinder.prototype, 'destroy')
  await run({ query: 'a.ts' })
  expect(destroy).not.toHaveBeenCalled()

  for (const close of closers.splice(0)) await close()
  expect(destroy).toHaveBeenCalledTimes(1)
})
