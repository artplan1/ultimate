// Fixtures shared by the two extension enablement test files beside this one: a home with a project folder and a server
// over it, plus the registry each file closes in its own afterAll. Two files share this because one file's afterAll
// closed twelve servers at once and outgrew its budget on a busy machine; each file now closes its own four.
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { context } from '../server/harness.ts'
import { fauxServer, removeTemp, temp } from './helpers.ts'

type FixtureServer = Awaited<ReturnType<typeof fauxServer>>
const homes: string[] = []
const servers: FixtureServer[] = []

/** Close this file's servers and remove its temp homes; call it from the file's afterAll. */
export async function closeFixtures() {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const home of homes.splice(0)) await removeTemp(home)
}
/** A temp home, removed with the file's others. */
export async function fixtureHome() {
  const home = await temp()
  homes.push(home)
  return home
}
/** A server a test built itself, closed with the file's others. */
export function keep(server: FixtureServer) {
  servers.push(server)
  return server
}
/** A home with a project folder and a server over it, with the user's settings written first when given. */
export async function fixture(settings?: string) {
  const home = await fixtureHome()
  const projectRoot = join(home, 'project')
  await mkdir(projectRoot)
  if (settings !== undefined) {
    await mkdir(join(home, '.ultimate'))
    await writeFile(join(home, '.ultimate/settings.json'), settings)
  }
  const server = keep(
    await fauxServer({
      ultimateRoot: resolve('.'),
      projectRoot,
      userHome: home,
      home: join(home, 'state'),
    }),
  )
  return { home, projectRoot, server }
}
export const tools = async (server: FixtureServer) =>
  (await server.root.agent(context)).tools.map((tool) => tool.name).toSorted()
export const web = async (server: FixtureServer) => server.web.facets()
