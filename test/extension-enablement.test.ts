// Enablement as layered settings say it: which extensions a settings file turns on or off, when an invalid edit keeps
// the last valid state, and what discovery decides by default. Facet and service ordering is in
// extension-facets.test.ts; the fixtures both files use are in extension-fixtures.ts.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { ProjectTrustStore } from '@earendil-works/pi-coding-agent'
import { discoverExtensions } from '../lib/discovery.ts'
import { defaultOff } from '../shared/extension-api.ts'
import { attach, fauxServer, sourceCopy, until } from './helpers.ts'
import { closeFixtures, fixture, fixtureHome, keep, tools, web } from './extension-fixtures.ts'

afterAll(closeFixtures)

it.concurrent('layers settings live, installs and uninstalls tools and web facets, and notices unknown names once', async () => {
  const { home, projectRoot, server } = await fixture()
  const config = join(projectRoot, '.ultimate')
  const settings = join(config, 'settings.json')
  const initialBuild = server.host.build().id
  const promptLoaded = server.extensions.info().find((entry) => entry.name === 'prompt')
    ?.server?.loadedAt
  expect(server.host.build().extensions.automations).toBeDefined()
  await mkdir(config)
  await writeFile(settings, JSON.stringify({ extensions: { disable: ['automations'] } }))
  await until(async () => !(await tools(server)).includes('automation'))
  await until(async () => !(await web(server)).some((path) => path.includes('/automations/')))
  await until(() => server.host.build().id !== initialBuild)
  expect(server.host.build().extensions.automations).toBeUndefined()
  expect(server.extensions.info().find((entry) => entry.name === 'prompt')?.server?.loadedAt).toBe(
    promptLoaded,
  )
  await rm(settings)
  await until(async () => (await tools(server)).includes('automation'))
  await until(async () => (await web(server)).some((path) => path.includes('/automations/')))
  await until(() => server.host.build().id === initialBuild)
  const folder = join(config, 'extensions/local')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'server.ts'),
    "import { defineExtension } from '@earendil-works/pi-durable'; export default defineExtension({ name: 'local' })",
  )
  await until(() => !!server.extensions.info().find((entry) => entry.name === 'local')?.server)
  await mkdir(join(home, '.ultimate'), { recursive: true })
  await writeFile(
    join(home, '.ultimate/settings.json'),
    JSON.stringify({ extensions: { disable: ['info', 'automations'] } }),
  )
  await until(
    () => server.extensions.info().find((entry) => entry.name === 'info')?.enabled === false,
  )
  const connection = await attach(server)
  try {
    await writeFile(
      settings,
      JSON.stringify({ extensions: { enable: ['automations', 'unknown'], disable: ['local'] } }),
    )
    await until(
      async () =>
        (await tools(server)).includes('automation') &&
        !server.extensions.info().find((entry) => entry.name === 'local')?.enabled,
    )
    expect(server.extensions.info().find((entry) => entry.name === 'local')?.server).toBeUndefined()
    expect(
      server.host.registry
        .snapshot()
        .installed()
        .some((entry) => entry.name === 'info' || entry.name === 'local'),
    ).toBe(false)
    await until(() =>
      connection.events.some(
        (entry) =>
          entry.name === 'notice' &&
          JSON.stringify(entry.data).includes('Unknown extension: unknown'),
      ),
    )
    await writeFile(join(folder, 'README.md'), 'Local extension.')
    await until(
      () =>
        server.extensions.info().find((entry) => entry.name === 'local')?.readme ===
        'Local extension.',
    )
    expect(
      connection.events.filter(
        (entry) =>
          entry.name === 'notice' &&
          JSON.stringify(entry.data).includes('Unknown extension: unknown'),
      ),
    ).toHaveLength(1)
  } finally {
    await connection.close()
  }
})

it.concurrent('retains valid enablement through invalid edits and delivers startup diagnostics to later clients', async () => {
  const valid = { extensions: { enable: ['unknown-startup'], disable: ['automations'] } }
  const { home, server } = await fixture(JSON.stringify(valid))
  const settings = join(home, '.ultimate/settings.json')
  const connection = await attach(server)
  try {
    expect(connection.system().extensionDiagnostics).toEqual(['Unknown extension: unknown-startup'])
    expect(await tools(server)).not.toContain('automation')
    const build = server.host.build().id
    const loadedAt = server.extensions.info().find((entry) => entry.name === 'plan')
      ?.server?.loadedAt
    for (const invalid of [
      '{"extensions":',
      '{"extensions":{"enable":"x"}}',
      '{"extensions":{"enable":["plan"],"disable":"x"}}',
    ]) {
      await writeFile(settings, invalid)
      server.vite.watcher.emit('change', settings)
      await until(() =>
        server.system
          .current()
          .extensionDiagnostics.some((message) => message.startsWith(settings + ':')),
      )
      expect(await tools(server)).not.toContain('automation')
      expect((await web(server)).some((path) => path.includes('/automations/'))).toBe(false)
      expect(server.host.build().id).toBe(build)
      expect(
        server.extensions.info().find((entry) => entry.name === 'plan')?.server?.loadedAt,
      ).toBe(loadedAt)
      await writeFile(settings, JSON.stringify(valid))
      server.vite.watcher.emit('change', settings)
      await until(() => server.system.current().extensionDiagnostics.length === 1)
    }
    const notices = () =>
      connection.events.filter(
        (event) =>
          event.name === 'notice' &&
          JSON.stringify(event.data).includes('Unknown extension: unknown-startup'),
      ).length
    const before = notices()
    await writeFile(settings, JSON.stringify({ ...valid, unrelated: 'ignored' }, null, 2))
    server.vite.watcher.emit('change', settings)
    await until(() => notices() > before)
    expect(server.host.build().id).toBe(build)
    await writeFile(settings, JSON.stringify({ extensions: { disable: ['plan'] } }))
    server.vite.watcher.emit('change', settings)
    await until(
      async () =>
        (await tools(server)).includes('automation') && !(await tools(server)).includes('plan'),
    )
    // Registry changes happen before the refreshed system snapshot is published.
    await until(() => server.system.current().extensionDiagnostics.length === 0)
    expect(server.system.current().extensionDiagnostics).toEqual([])
  } finally {
    await connection.close()
  }
})

it.concurrent('keeps a core-tier extension enabled over extensions.disable, with a diagnostic', async () => {
  const { home, server } = await fixture(
    JSON.stringify({ extensions: { disable: ['subagents', 'automations'] } }),
  )
  const info = (name: string) => server.extensions.info().find((entry) => entry.name === name)
  expect(info('subagents')).toMatchObject({ enabled: true, core: true })
  expect(info('subagents')?.server?.error).toBeUndefined()
  expect(await tools(server)).toContain('subagent')
  expect(info('automations')).toMatchObject({ enabled: false })
  expect(info('automations')?.core).toBeUndefined()
  expect(server.system.current().extensionDiagnostics).toEqual([
    'subagents is core and stays enabled; extensions.disable ignores it',
  ])
  const discovered = await discoverExtensions(resolve('.'), join(home, 'project'), home)
  expect(discovered.find((entry) => entry.name === 'subagents')).toMatchObject({
    enabled: true,
    core: true,
  })
})

it.concurrent('enables every built-in by default except the default-off ones', async () => {
  const home = await fixtureHome()
  const root = await sourceCopy(home)
  const projectRoot = join(home, 'project')
  await mkdir(projectRoot)
  const discovered = await discoverExtensions(root, projectRoot, home)
  const server = keep(
    await fauxServer({
      ultimateRoot: root,
      projectRoot,
      userHome: home,
      home: join(home, 'state'),
    }),
  )
  const info = server.extensions.info()
  const off = info.filter((entry) => !entry.enabled).map((entry) => entry.name)
  expect(off.toSorted()).toEqual([...defaultOff].toSorted())
  expect(info.find((entry) => entry.name === 'sounds')).toMatchObject({ layer: 'default' })
  expect(info.every((entry) => !entry.server?.error)).toBe(true)
  expect(
    discovered
      .filter((entry) => !entry.enabled)
      .map((entry) => entry.name)
      .toSorted(),
  ).toEqual([...defaultOff].toSorted())
})

/** Discovery with every claim disabled in the user's settings; each [source, name] folder declares the core tier. */
async function discoverCoreClaims(claims: ['user' | 'project', string][]) {
  const home = await fixtureHome()
  const projectRoot = join(home, 'project')
  await mkdir(join(projectRoot, '.ultimate'), { recursive: true })
  await mkdir(join(home, '.ultimate'), { recursive: true })
  await writeFile(
    join(home, '.ultimate/settings.json'),
    JSON.stringify({ extensions: { disable: claims.map(([, name]) => name) } }),
  )
  new ProjectTrustStore(join(home, '.ultimate')).set(projectRoot, true)
  for (const [source, name] of claims) {
    const folder = join(source === 'user' ? home : projectRoot, '.ultimate/extensions', name)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'api.ts'), "export const tier = 'core'\n")
  }
  const discovered = await discoverExtensions(resolve('.'), projectRoot, home)
  return (name: string) => discovered.find((entry) => entry.name === name)
}

it.concurrent('lets extensions.disable turn off a user or project extension that declares the core tier', async () => {
  const find = await discoverCoreClaims([
    ['user', 'user-core-claim'],
    ['project', 'project-core-claim'],
  ])
  expect(find('user-core-claim')).toMatchObject({ source: 'user', enabled: false })
  expect(find('project-core-claim')).toMatchObject({ source: 'project', enabled: false })
})

it.concurrent('keeps a user or project replacement of a core built-in core, over extensions.disable', async () => {
  const find = await discoverCoreClaims([
    ['user', 'subagents'],
    ['project', 'lineage'],
  ])
  expect(find('subagents')).toMatchObject({ source: 'user', core: true, enabled: true })
  expect(find('lineage')).toMatchObject({ source: 'project', core: true, enabled: true })
})

it.concurrent('turns a default-off built-in on from user or project settings', async () => {
  const home = await fixtureHome()
  const projectRoot = join(home, 'project')
  await mkdir(join(projectRoot, '.ultimate'), { recursive: true })
  await mkdir(join(home, '.ultimate'))
  await writeFile(
    join(home, '.ultimate/settings.json'),
    JSON.stringify({ extensions: { enable: ['sounds'] } }),
  )
  await writeFile(
    join(projectRoot, '.ultimate/settings.json'),
    JSON.stringify({ extensions: { enable: ['health'] } }),
  )
  new ProjectTrustStore(join(home, '.ultimate')).set(projectRoot, true)
  const discovered = await discoverExtensions(resolve('.'), projectRoot, home)
  const enabled = (name: string) => discovered.find((entry) => entry.name === name)?.enabled
  expect(enabled('sounds')).toBe(true)
  expect(enabled('health')).toBe(true)
  expect(enabled('cloud')).toBe(false)
  expect(discovered.settings.layers.get('sounds')).toBe('user')
  expect(discovered.settings.layers.get('health')).toBe('project')
})

it.concurrent('turns the updater on by default, and keeps it off for a user who disabled it', async () => {
  const home = await fixtureHome()
  const projectRoot = join(home, 'project')
  await mkdir(projectRoot)
  const enabled = async () =>
    (await discoverExtensions(resolve('.'), projectRoot, home)).find(
      (entry) => entry.name === 'update',
    )?.enabled
  expect(defaultOff).not.toContain('update')
  expect(await enabled()).toBe(true)
  await mkdir(join(home, '.ultimate'), { recursive: true })
  await writeFile(
    join(home, '.ultimate/settings.json'),
    JSON.stringify({ extensions: { disable: ['update'] } }),
  )
  expect(await enabled()).toBe(false)
})
