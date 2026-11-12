import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { fauxServer, removeTemp, temp, until } from './helpers.ts'

const homes: string[] = []
afterAll(async () => {
  for (const home of homes.splice(0)) await removeTemp(home)
})

async function target(home: string, folder: string, answer: string) {
  const dir = join(home, folder, 'linked')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'server.ts'),
    `export const actions = { which: () => ${JSON.stringify(answer)} }
export default { name: 'linked' }
`,
  )
  return dir
}

it('loads a linked extension from its new target after the link is repointed and the old target deleted', async () => {
  const home = await temp()
  homes.push(home)
  const projectRoot = join(home, 'project')
  await mkdir(projectRoot)
  const link = join(home, '.ultimate/extensions/linked')
  await mkdir(join(home, '.ultimate/extensions'), { recursive: true })
  await symlink(await target(home, 'a', 'A'), link)
  const server = await fauxServer({
    ultimateRoot: resolve('.'),
    projectRoot,
    userHome: home,
    home: join(home, 'state'),
  })
  try {
    const which = () => server.extensions.action('linked', 'which')?.({}, {} as never)
    expect(await which()).toBe('A')
    const loadedAt = server.extensions.info().find((entry) => entry.name === 'linked')
      ?.server?.loadedAt
    const b = await target(home, 'b', 'B')
    await rm(link)
    await symlink(b, link)
    await rm(join(home, 'a'), { recursive: true })
    // Saving a file reloads the extension, as an edit does on the live host.
    await writeFile(join(b, 'server.ts'), (await readFile(join(b, 'server.ts'), 'utf8')) + '\n')
    const record = () => server.extensions.info().find((entry) => entry.name === 'linked')
    await until(() => !!record()?.server?.error || record()?.server?.loadedAt !== loadedAt)
    expect(record()?.server?.error).toBeUndefined()
    expect(await which()).toBe('B')
  } finally {
    await server.close()
  }
})

it("reloads a linked extension's server facet when the watcher reports a file by its real path", async () => {
  const home = await temp()
  const outside = await temp()
  homes.push(home, outside)
  const projectRoot = join(home, 'project')
  await mkdir(projectRoot)
  // The target sits outside every extension root, as a separate checkout does.
  const dir = join(outside, 'linked')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'server.ts'),
    `export const actions = { which: () => 'A' }
export default { name: 'linked' }
`,
  )
  await mkdir(join(home, '.ultimate/extensions'), { recursive: true })
  await symlink(dir, join(home, '.ultimate/extensions/linked'))
  const server = await fauxServer({
    ultimateRoot: resolve('.'),
    projectRoot,
    userHome: home,
    home: join(home, 'state'),
  })
  try {
    const which = () => server.extensions.action('linked', 'which')?.({}, {} as never)
    expect(await which()).toBe('A')
    const record = () => server.extensions.info().find((entry) => entry.name === 'linked')
    const loadedAt = record()?.server?.loadedAt
    // Following the link, macOS reports a change inside it once, at the target's real path, which names no root and no
    // extension directory. Nothing is written: the event a real save delivers is what the loader must place.
    server.vite.watcher.emit('change', join(dir, 'server.ts'))
    await until(() => !!record()?.server?.error || record()?.server?.loadedAt !== loadedAt, 15000)
    expect(record()?.server?.error).toBeUndefined()
    expect(await which()).toBe('A')
  } finally {
    await server.close()
  }
})

it("reloads a linked extension's server facet when a file its server.ts imports changes", async () => {
  const home = await temp()
  homes.push(home)
  const projectRoot = join(home, 'project')
  await mkdir(projectRoot)
  const dir = join(home, 'real', 'linked')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'logic.ts'), "export const answer = 'A'\n")
  await writeFile(
    join(dir, 'server.ts'),
    `import { answer } from './logic.ts'
export const actions = { which: () => answer }
export default { name: 'linked' }
`,
  )
  await mkdir(join(home, '.ultimate/extensions'), { recursive: true })
  await symlink(dir, join(home, '.ultimate/extensions/linked'))
  const server = await fauxServer({
    ultimateRoot: resolve('.'),
    projectRoot,
    userHome: home,
    home: join(home, 'state'),
  })
  try {
    const which = () => server.extensions.action('linked', 'which')?.({}, {} as never)
    expect(await which()).toBe('A')
    const record = () => server.extensions.info().find((entry) => entry.name === 'linked')
    const loadedAt = record()?.server?.loadedAt
    await writeFile(join(dir, 'logic.ts'), "export const answer = 'B'\n")
    await until(() => !!record()?.server?.error || record()?.server?.loadedAt !== loadedAt)
    expect(record()?.server?.error).toBeUndefined()
    expect(await which()).toBe('B')
  } finally {
    await server.close()
  }
})

it('loads an extension a reload of another one discovers when the folder event never came', async () => {
  const home = await temp()
  homes.push(home)
  const projectRoot = join(home, 'project')
  await mkdir(projectRoot)
  const dir = join(home, 'real', 'linked')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'server.ts'),
    `export const actions = { which: () => 'linked' }
export default { name: 'linked' }
`,
  )
  await mkdir(join(home, '.ultimate/extensions'), { recursive: true })
  await symlink(dir, join(home, '.ultimate/extensions/linked'))
  const server = await fauxServer({
    ultimateRoot: resolve('.'),
    projectRoot,
    userHome: home,
    home: join(home, 'state'),
  })
  try {
    expect(server.extensions.action('linked', 'which')?.({}, {} as never)).toBe('linked')
    // A folder that appears while the loader hears nothing about it: the live host loses such an event when a symlink
    // is renamed onto a folder it has just written.
    server.vite.watcher.unwatch(join(home, '.ultimate/extensions'))
    const added = join(home, 'real', 'newext')
    await mkdir(added, { recursive: true })
    await writeFile(
      join(added, 'server.ts'),
      `export const actions = { which: () => 'newext' }
export default { name: 'newext' }
`,
    )
    await symlink(added, join(home, '.ultimate/extensions/newext'))
    // The next save in the extension that is loaded reloads only it; discovery still sees the new folder.
    server.vite.watcher.emit('change', join(dir, 'server.ts'))
    const record = () => server.extensions.info().find((entry) => entry.name === 'newext')
    await until(() => !!record())
    expect(record()?.server).toBeDefined()
    expect(record()?.server?.error).toBeUndefined()
    expect(server.extensions.action('newext', 'which')?.({}, {} as never)).toBe('newext')
  } finally {
    await server.close()
  }
})
