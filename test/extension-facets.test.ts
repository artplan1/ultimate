// Which facet wins when extensions of different layers provide the same tool name or service, and what happens to a
// provider while its extension reloads or the settings disable it. Settings layering and discovery live in
// extension-enablement.test.ts; the fixtures both files use are in extension-fixtures.ts. These four run one at a
// time: each boots a server over a copy of the repository, and two files of three concurrent boots each starve the
// machine this suite runs its checks on.
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { context } from '../server/harness.ts'
import { compareExtensions } from '../server/discovery.ts'
import { createRegistry, toolRenderers } from '../web/src/sdk/registry.ts'
import { fauxServer, until } from './helpers.ts'
import { closeFixtures, fixture, fixtureHome, keep, web } from './extension-fixtures.ts'

afterAll(closeFixtures)

const serviceFacet = (detail: string, fail = false) => `
import { defineExtension } from '@earendil-works/pi-durable'
const Api = { name: 'service-test' }
export const actions = { lookup: async (_args, { host }) => ({ detail: host.want(Api)?.detail }) }
export default (host) => {
  host.implement(Api, { detail: '${detail}' })
  ${fail ? "throw new Error('failed service installation')" : ''}
  host.onOpen(async () => {})
  return defineExtension({ name: 'service-test' })
}`

it('orders facets by source so a project bash tool and renderer win regardless of folder name', async () => {
  const home = await fixtureHome()
  const projectRoot = join(home, 'project')
  for (const [name, root] of [
    ['zzz-bash', home],
    ['aaa-bash', projectRoot],
  ]) {
    const folder = join(root, '.ultimate/extensions', name)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'web.tsx'), 'export default { tools: { bash: () => null } }')
    await writeFile(
      join(folder, 'server.ts'),
      `
      import { obj } from '@earendil-works/pi-schema'
      import { defineExtension, defineTool } from '@earendil-works/pi-durable'
      export default defineExtension({ name: '${name}', tools: [defineTool({
        name: 'bash', description: '${name}', parameters: obj({}),
        execute: async () => ({})
      })] })
    `,
    )
  }
  const server = keep(
    await fauxServer({
      ultimateRoot: resolve('.'),
      projectRoot,
      userHome: home,
      home: join(home, 'state'),
    }),
  )
  expect(
    server.extensions
      .info()
      .filter((e) => ['coding-tools', 'zzz-bash', 'aaa-bash'].includes(e.name))
      .map((e) => e.name),
  ).toEqual(['coding-tools', 'zzz-bash', 'aaa-bash'])
  expect(
    (await server.root.agent(context)).tools.find((tool) => tool.name === 'bash')?.description,
  ).toBe('aaa-bash')
  const paths = (await web(server)).filter((path) =>
    ['coding-tools', 'zzz-bash', 'aaa-bash'].some((name) => path.includes(`/${name}/`)),
  )
  const registry = createRegistry()
  await registry.setLoaders(
    Object.fromEntries(
      paths.map((path) => [
        path,
        () =>
          // The built-in UI needs browser globals; only its registry position matters here.
          path.includes('/coding-tools/')
            ? Promise.resolve({ default: { tools: { bash: () => null } } })
            : server.vite.ssrLoadModule(path),
      ]),
    ),
  )
  expect(registry.getSnapshot().every((record) => !record.error)).toBe(true)
  expect(toolRenderers(registry.getSnapshot(), 'bash').at(-1)?.extension).toBe('aaa-bash')
  // An explicit server order still takes precedence over source layering.
  expect(
    [
      { name: 'coding-tools', source: 'builtin' as const },
      { name: 'aaa-bash', source: 'project' as const, order: -100 },
    ]
      .toSorted(compareExtensions)
      .map((e) => e.name),
  ).toEqual(['aaa-bash', 'coding-tools'])
})

it('refuses a tool name another extension of the same layer already provides', async () => {
  const { home, projectRoot, server } = await fixture('{}')
  const facet = (name: string, version = '') => `
    import { obj } from '@earendil-works/pi-schema'
    import { defineExtension, defineTool } from '@earendil-works/pi-durable'
    export default defineExtension({ name: '${name}', tools: [defineTool({
      name: 'clash_tool', description: '${name}${version}', parameters: obj({}),
      execute: async () => ({})
    })] })`
  const files: Record<string, string> = {}
  for (const name of ['aaa-clash', 'bbb-clash']) {
    const folder = join(projectRoot, '.ultimate/extensions', name)
    await mkdir(folder, { recursive: true })
    files[name] = join(folder, 'server.ts')
    await writeFile(files[name], facet(name))
  }
  const info = (name: string) => server.extensions.info().find((e) => e.name === name)
  const clash = async () =>
    (await server.root.agent(context)).tools.find((tool) => tool.name === 'clash_tool')?.description
  await until(() => !!info('bbb-clash')?.server)
  expect(info('bbb-clash')?.server?.error).toBe(
    'Error: clash_tool is already provided by aaa-clash',
  )
  expect(await clash()).toBe('aaa-clash')
  // A reload of the holder does not clash with its own name.
  await writeFile(files['aaa-clash'], facet('aaa-clash', ' v2'))
  server.vite.watcher.emit('change', files['aaa-clash'])
  await until(async () => (await clash()) === 'aaa-clash v2')
  expect(info('aaa-clash')?.server?.error).toBeUndefined()
  // Once the holder is disabled, the other extension's next reload takes the name.
  await writeFile(
    join(home, '.ultimate/settings.json'),
    JSON.stringify({ extensions: { disable: ['aaa-clash'] } }),
  )
  await until(() => info('aaa-clash')?.enabled === false)
  server.vite.watcher.emit('change', files['bbb-clash'])
  await until(async () => (await clash()) === 'bbb-clash')
  expect(info('bbb-clash')?.server?.error).toBeUndefined()
})

it('keeps the provider on a failed reload, replaces it on reload and drops it on disable', async () => {
  const { home, projectRoot, server } = await fixture()
  const folder = join(projectRoot, '.ultimate/extensions/service-test')
  await mkdir(folder, { recursive: true })
  const file = join(folder, 'server.ts')
  await writeFile(file, serviceFacet('first'))
  await until(() => !!server.extensions.action('service-test', 'lookup'))
  const lookup = () =>
    server.extensions.invoke('service-test', 'lookup', {}, new AbortController().signal)
  expect(await lookup()).toEqual({ detail: 'first' })
  await writeFile(file, serviceFacet('failed', true))
  server.vite.watcher.emit('change', file)
  await until(
    () =>
      server.extensions
        .info()
        .find((e) => e.name === 'service-test')
        ?.server?.error?.includes('failed service installation') === true,
  )
  expect(await lookup()).toEqual({ detail: 'first' })
  await writeFile(file, serviceFacet('replacement'))
  server.vite.watcher.emit('change', file)
  await until(async () => ((await lookup()) as { detail?: string })?.detail === 'replacement')
  const consumer = join(projectRoot, '.ultimate/extensions/service-consumer')
  await mkdir(consumer, { recursive: true })
  await writeFile(
    join(consumer, 'server.ts'),
    `
    import { defineExtension } from '@earendil-works/pi-durable'
    export const actions = { lookup: async (_args, { host }) => host.want({ name: 'service-test' })?.detail ?? null }
    export default defineExtension({ name: 'service-consumer' })
  `,
  )
  await until(() => !!server.extensions.action('service-consumer', 'lookup'))
  await writeFile(
    join(home, '.ultimate/settings.json'),
    JSON.stringify({ extensions: { disable: ['service-test'] } }),
  )
  await until(
    () => server.extensions.info().find((e) => e.name === 'service-test')?.enabled === false,
  )
  expect(
    await server.extensions.invoke('service-consumer', 'lookup', {}, new AbortController().signal),
  ).toBeNull()
})

it('keeps the replacement provider available while the old cleanup is pending', async () => {
  const { projectRoot, server } = await fixture()
  const folder = join(projectRoot, '.ultimate/extensions/service-test')
  await mkdir(folder, { recursive: true })
  const file = join(folder, 'server.ts')
  await writeFile(
    file,
    serviceFacet('first')
      .replace(
        'lookup: async',
        "gate: async (_args, { host }) => host.resource('service-test:cleanup', () => null), lookup: async",
      )
      .replace(
        'host.onOpen(async',
        "const gate = host.resource('service-test:cleanup', () => ({ started: Promise.withResolvers(), cleanup: Promise.withResolvers() })); host.onClose(async () => { gate.started.resolve(); await gate.cleanup.promise }); host.onOpen(async",
      ),
  )
  await until(() => !!server.extensions.action('service-test', 'lookup'))
  const lookup = () =>
    server.extensions.invoke('service-test', 'lookup', {}, new AbortController().signal)
  expect(await lookup()).toEqual({ detail: 'first' })
  const { started, cleanup } = (await server.extensions.invoke(
    'service-test',
    'gate',
    {},
    new AbortController().signal,
  )) as unknown as { started: PromiseWithResolvers<void>; cleanup: PromiseWithResolvers<void> }
  try {
    await writeFile(file, serviceFacet('replacement'))
    server.vite.watcher.emit('change', file)
    await started.promise
    expect(await lookup()).toEqual({ detail: 'replacement' })
  } finally {
    cleanup.resolve()
  }
  expect(await lookup()).toEqual({ detail: 'replacement' })
})
