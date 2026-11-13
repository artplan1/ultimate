import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { context } from '../server/harness.ts'
import type { ExtensionHost } from '../server/extensions.ts'
import self from '../extensions/self/server.ts'
import { fauxServer, temp, removeTemp, until } from './helpers.ts'

/** The folder and names the building_blocks section lists as available but off. */
function offFolders(section: string) {
  return new Map(
    section
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line): [string, string] => {
        const [folder, ...descriptions] = line.slice(2).split(': ')
        const names = descriptions
          .join(': ')
          .split('; ')
          .map((entry) => entry.split(': ')[0])
        return [folder, names.join(', ')]
      }),
  )
}
/** The extension names the building_blocks section lists as available but off. */
function offNames(section: string) {
  return [...offFolders(section).values()].flatMap((names) => names.split(', '))
}

it('scopes development guidance to the Ultimate host, using its workspace docs', async () => {
  const ultimateRoot = '/ultimate'
  const own = { path: '/workspace', source: ultimateRoot }
  async function render(projectRoot: string) {
    const extension = self({
      ultimateRoot,
      projectRoot,
      need: () => ({ get: async () => own }),
    } as unknown as ExtensionHost)
    return extension.sections![0].render(
      { conversationId: 1 } as Parameters<NonNullable<typeof extension.sections>[0]['render']>[0],
      context,
    )
  }
  const clone = await render(ultimateRoot)
  expect(clone).toContain('The host project is Ultimate itself.')
  expect(clone).toContain('Before changing Ultimate, read /workspace/AGENTS.md')
  expect(clone).toContain('Call restart only after a landing')
  expect(clone).toContain('Land your workspace into /ultimate first')

  const project = await render('/project')
  expect(project).toContain('guide them from /ultimate/README.md')
  expect(project).not.toContain('Before changing Ultimate')
  expect(project).not.toContain('Call restart')
  expect(project).not.toContain('Land your workspace')
})

it('renders only enabled guidance, lists off building blocks, and adds self guidance live', async () => {
  const home = await temp()
  vi.stubEnv('PI_CODING_AGENT_DIR', join(home, 'pi'))
  // Pi's personal instructions and skills stay with Pi; Ultimate's come from ~/.ultimate.
  for (const [dir, owner] of [
    ['pi', 'Pi'],
    ['.ultimate', 'Ultimate'],
  ]) {
    const skill = join(home, dir, 'skills', `${owner.toLowerCase()}-only`)
    await mkdir(skill, { recursive: true })
    await writeFile(join(home, dir, 'AGENTS.md'), `${owner} personal instructions.`)
    await writeFile(
      join(skill, 'SKILL.md'),
      `---\nname: ${owner.toLowerCase()}-only\ndescription: ${owner} skill\n---\n`,
    )
  }
  const projectRoot = join(home, 'project')
  await mkdir(join(projectRoot, '.ultimate'), { recursive: true })
  // An extension outside the clone: the section must name the folder it really is in.
  const lab = join(home, '.ultimate/extensions/extra-lab')
  await mkdir(lab, { recursive: true })
  await writeFile(join(lab, 'README.md'), 'An extra lab.\n')
  const settings = join(projectRoot, '.ultimate/settings.json')
  await writeFile(settings, JSON.stringify({ extensions: { disable: ['self', 'extra-lab'] } }))
  const server = await fauxServer({
    ultimateRoot: resolve('.'),
    projectRoot,
    userHome: home,
    home: join(home, 'state'),
  })
  try {
    async function render(cwd = projectRoot, useEnv = true) {
      const agent = await server.root.agent(context)
      const sections: Record<string, string> = {}
      for (const extension of server.host.registry.snapshot().installed()) {
        if (!['prompt', 'self'].includes(extension.name)) continue
        for (const section of extension.sections ?? []) {
          const value = await section.render(
            {
              conversationId: server.root.id,
              agent: { ...agent, cwd },
              env: useEnv ? { cwd } : undefined,
            } as Parameters<typeof section.render>[0],
            context,
          )
          if (value) sections[section.key] = value
        }
      }
      return sections
    }
    const withoutSelf = await render()
    expect(withoutSelf.self).toBeUndefined()
    expect(offNames(withoutSelf.building_blocks)).toContain('self')
    expect(offNames(withoutSelf.building_blocks)).toContain('extra-lab')
    // A user folder is listed as itself, not as the clone's extensions folder.
    expect(
      offFolders(withoutSelf.building_blocks).get(`${join(home, '.ultimate/extensions')}/`),
    ).toBe('extra-lab')

    await writeFile(settings, '{}')
    server.vite.watcher.emit('change', settings)
    // Each extension lands on its own: wait until the section itself reports the reload.
    await until(async () => !offNames((await render()).building_blocks).includes('extra-lab'))
    const withSelf = await render()
    expect(withSelf.self).toContain(`${server.host.ultimateRoot}/README.md`)
    expect(withSelf.self).not.toContain('Before changing Ultimate')
    expect(withSelf.self).not.toContain('Call restart')
    // Only the default-off built-ins are left to list.
    expect(offNames(withSelf.building_blocks)).not.toContain('self')
    expect(offNames(withSelf.building_blocks)).not.toContain('extra-lab')
    expect(offNames(withSelf.building_blocks)).toContain('sounds')
    expect([...offFolders(withSelf.building_blocks).keys()]).toEqual([
      `${server.host.ultimateRoot}/extensions/`,
    ])

    const checkout = join(home, 'isolated-work')
    await mkdir(checkout)
    await writeFile(join(checkout, 'AGENTS.md'), 'Isolated project instructions.')
    const skills = vi.spyOn(server.host, 'skills')
    for (const useEnv of [true, false]) {
      const isolated = await render(checkout, useEnv)
      expect(isolated.cwd).toBe(checkout)
      expect(isolated.project_context).toContain('Isolated project instructions.')
      expect(isolated.project_context).toContain('Ultimate personal instructions.')
      expect(isolated.project_context).not.toContain('Pi personal instructions.')
      expect(isolated.skills).toContain('ultimate-only')
      expect(isolated.skills).not.toContain('pi-only')
      expect(skills).toHaveBeenLastCalledWith(checkout)
    }
    skills.mockRestore()
  } finally {
    await server.close()
    await removeTemp(home)
  }
})
