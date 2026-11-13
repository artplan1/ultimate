import { EventEmitter } from 'node:events'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createWeb } from '../server/web.ts'
import type { Watch } from '../server/extensions.ts'
import type { WebBuildRequest } from '../server/web-build.ts'
import { temp, until } from './helpers.ts'

const build = vi.hoisted(() => vi.fn<typeof import('../lib/exec.ts').exec>())
vi.mock('../lib/exec.ts', async (original) => ({
  ...(await original<typeof import('../lib/exec.ts')>()),
  exec: build,
}))

afterEach(() => vi.useRealTimers())

async function fixture(existing: boolean) {
  const home = await temp()
  const outside = await temp()
  const ultimateRoot = join(home, 'ultimate')
  const projectRoot = join(home, 'project')
  const userHome = join(home, 'user')
  const target = join(outside, 'linked')
  const link = join(userHome, '.ultimate/extensions/linked')
  const source = join(target, 'web.tsx')
  await mkdir(join(ultimateRoot, 'web/public'), { recursive: true })
  await mkdir(projectRoot)
  await mkdir(target)
  await mkdir(join(userHome, '.ultimate/extensions'), { recursive: true })
  await symlink(target, link)
  if (existing) await writeFile(source, 'export default { version: "old" }')
  // Only the build subprocess is replaced: discovery, manifests and invalidation run as in the host.
  build.mockImplementation(async (_command, args = []) => {
    const request = JSON.parse(args[1]) as WebBuildRequest
    const content = await readFile(source, 'utf8').catch(() => '')
    await mkdir(request.outDir, { recursive: true })
    await writeFile(join(request.outDir, 'index.html'), `<head></head>${content}`)
    return { stdout: JSON.stringify({ inputs: content ? [source] : [] }), stderr: '' }
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn<() => void>() })
  const notices = vi.fn<(message: string) => void>()
  const web = await createWeb({
    ultimateRoot,
    projectRoot,
    userHome,
    home: join(home, 'state'),
    watch: ((attach) => attach(watcher as never)) satisfies Watch,
    before: async () => {},
    pages: () => 1,
    changed: () => {},
    notice: notices,
  })
  await web.rebuild()
  const previous = web.info().id
  const rebuilt = async () => {
    await until(
      () => web.info().id !== previous && !web.info().building,
      1000,
      () => vi.advanceTimersByTimeAsync(150),
    )
    expect(notices.mock.calls).toEqual([])
    const manifest = JSON.parse(await readFile(join(home, 'state/web/manifest.json'), 'utf8'))
    expect(manifest.facets).toContain(join(link, 'web.tsx'))
    return readFile(join(home, 'state/web', web.info().id, 'index.html'), 'utf8')
  }
  return { web, watcher, source, rebuilt }
}

it('rebuilds when a web facet is added to an already linked target', async () => {
  const { web, watcher, source, rebuilt } = await fixture(false)
  try {
    await writeFile(source, 'export default { version: "new" }')
    watcher.emit('add', source)
    expect(await rebuilt()).toContain('new')
  } finally {
    await web.close()
  }
})

it('rebuilds when an existing linked web source changes at its real path', async () => {
  const { web, watcher, source, rebuilt } = await fixture(true)
  try {
    await writeFile(source, 'export default { version: "new" }')
    watcher.emit('change', source)
    expect(await rebuilt()).toContain('new')
  } finally {
    await web.close()
  }
})
