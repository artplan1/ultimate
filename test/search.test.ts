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
      prepared as never,
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

  const regex = await run({ pattern: 'run\\w+', mode: 'regex' })
  expect(regex.details.items).toEqual([
    {
      path: 'src/runner.ts',
      line: 3,
      text: 'export function runWorkflow() {}',
      before: ['import { start } from "./start"', 'const ready = true'],
    },
  ])
})

it('rejects ambiguous or empty requests', async () => {
  const { root, run } = await fixture()
  await writeFile(join(root, 'a.ts'), 'hello\n')
  await expect(run({ query: 'a', pattern: 'b' })).rejects.toThrow(
    'either query (find files by path) or pattern',
  )
  await expect(run({})).rejects.toThrow('Pass query (fuzzy path search)')
  await expect(run({ query: 'a', context: 1 })).rejects.toThrow(
    'mode and context apply to content search',
  )
  await expect(run({ glob: '*.ts', mode: 'regex' })).rejects.toThrow(
    'mode and context apply to content search',
  )
  await expect(run({ pattern: 'a(b', mode: 'regex' })).rejects.toThrow('Invalid regular expression')
})

it('bounds items by limit and reports how many are left', async () => {
  const { root, run } = await fixture()
  await mkdir(join(root, 'many'))
  for (let index = 0; index < 5; index++) await writeFile(join(root, 'many', `item${index}.ts`), '')
  // Written before the first search: the tests never wait for the watcher to pick a new file up.
  await writeFile(
    join(root, 'many', 'lines.ts'),
    Array.from({ length: 12 }, (_, index) => `hit ${index}`).join('\n') + '\n',
  )
  const listed = await run({ glob: 'many/*.ts', limit: 2 })
  expect(listed.details.items).toHaveLength(2)
  expect(listed.details.total).toBe(6)
  expect(listed.details.more).toBe(4)
  expect(listed.text).toContain('Found 6 files, showing 2:')
  expect(listed.text).toContain('4 more files; raise limit or narrow the glob.')

  const matches = await run({ glob: 'many/lines.ts', pattern: 'hit', limit: 3, context: 0 })
  expect(matches.details.items).toHaveLength(3)
  expect(matches.details.total).toBe(3)
  expect(matches.details.more).toBe(1)
  expect(matches.text).toContain('More matches than shown')

  const capped = await run({ glob: 'many/lines.ts', pattern: 'hit 11', context: 99 })
  expect(capped.details.items[0].before).toHaveLength(10)
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
