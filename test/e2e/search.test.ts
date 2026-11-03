import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createIndex } from '../../extensions/search/search.ts'
import { removeTemp, temp } from '../helpers.ts'

const indexes: ReturnType<typeof createIndex>[] = []
const roots: string[] = []

afterEach(async () => {
  for (const index of indexes.splice(0)) index.dispose()
  for (const root of roots.splice(0)) await removeTemp(root)
})

async function fixture() {
  const root = await temp('ultimate-search-regex-')
  roots.push(root)
  const index = createIndex()
  indexes.push(index)
  return {
    root,
    search: (request: Parameters<typeof index.search>[0]) => index.search(request, root),
  }
}

it('searches raw regex without turning whitespace or path-like text into query constraints', async () => {
  const { root, search } = await fixture()
  await mkdir(join(root, 'src'))
  const source = 'before\nfoo123bar\nfoo  bar\nfoo bar\nsrc/foo.ts TODO\nplain TODO\nafter\n'
  await writeFile(join(root, 'src', 'foo.ts'), source)
  await writeFile(join(root, 'other.txt'), source)

  expect((await search({ pattern: 'foo\\d+bar', context: 0 })).items).toHaveLength(2)
  expect(
    (await search({ pattern: 'foo  bar|missing', context: 0 })).items.map((item) => item.text),
  ).toEqual(['foo  bar', 'foo  bar'])
  const pathLike = await search({ pattern: 'src/foo.* TODO', context: 0 })
  expect(pathLike.items.map((item) => item.path).toSorted()).toEqual(['other.txt', 'src/foo.ts'])
  expect(pathLike.items.every((item) => item.text === 'src/foo.ts TODO')).toBe(true)

  const filtered = await search({ pattern: 'foo\\d+bar', glob: 'src/*.ts', context: 1, limit: 1 })
  expect(filtered).toEqual({
    kind: 'content',
    items: [
      { path: 'src/foo.ts', line: 2, text: 'foo123bar', before: ['before'], after: ['foo  bar'] },
    ],
    total: 1,
    more: 0,
  })
  const bounded = await search({ pattern: 'foo.*bar', glob: 'src/*.ts', context: 1, limit: 1 })
  expect(bounded.items).toEqual(filtered.items)
  expect(bounded.more).toBe(1)
})

it('retries an unsupported regex as exact literal text', async () => {
  const { root, search } = await fixture()
  await writeFile(join(root, 'spaced.ts'), 'foo  (?=bar)\nfoo (?=bar)\n')
  const kept = await search({ pattern: 'foo  (?=bar)', context: 0 })
  expect(kept.items).toEqual([{ path: 'spaced.ts', line: 1, text: 'foo  (?=bar)' }])
})
