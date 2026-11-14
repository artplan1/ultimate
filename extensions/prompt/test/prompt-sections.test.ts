import { expect, it } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ExtensionHost } from '../../../server/extensions.ts'
import prompt from '../server.ts'

it('scopes durable and file-operation guidance to the available tools', async () => {
  const sections = prompt({} as ExtensionHost).sections!
  async function render(key: string, tools: string[]) {
    const section = sections.find((item) => item.key === key)!
    return section.render(
      { agent: { tools: tools.map((name) => ({ name })) } } as unknown as Parameters<
        typeof section.render
      >[0],
      BACKGROUND_CONTEXT,
    )
  }

  const scout = ['read', 'grep', 'find', 'bash']
  const reader = await render('tools', scout)
  expect(reader).toContain('Content lookups use grep, never shell rg/grep')
  expect(reader).toContain('File lookups use find, never shell find/fd/ls')
  expect(reader).toContain('interruptible: true')
  expect(reader).not.toContain('batch changes')
  expect(reader).not.toContain('generated output')

  const writer = await render('tools', [...scout, 'edit', 'write'])
  expect(writer).toContain('re-read the region')
  expect(writer).toContain('widen oldText with surrounding lines before retrying')
  expect(writer).toContain('Use dedicated read/edit/write tools')
  expect(writer).toContain('mechanical changes across many files')

  const basic = await render('self_awareness', scout)
  expect(basic).toContain('Interrupted tools may have completed')
  expect(basic).toContain('never on queued `pi.inbox` inputs before delivery')
  expect(basic).not.toContain('ultimate.search()')
  expect(basic).not.toContain('ultimate.extensions()')
  expect(basic).not.toContain('Subagents')
  const coordinator = await render('self_awareness', [...scout, 'codemode', 'subagent'])
  expect(coordinator).toContain('ultimate.search()')
  expect(coordinator).toContain('ultimate.extensions()')
  expect(coordinator).toContain('Subagents have separate contexts')
  expect(coordinator).toContain('re-read files named by "Docs changed"')
})

it('offers disabled extensions to the standing ultimate, not branches or children', async () => {
  const host = {
    harness: () => ({ snapshot: async () => ({ ultimate: 11 }) }),
    extensions: () => [
      {
        name: 'example',
        enabled: false,
        path: '/extensions/example',
        readme: 'Example capability.',
      },
      { name: 'active', enabled: true, path: '/extensions/active', readme: 'Already enabled.' },
    ],
    projectRoot: '/project',
  } as unknown as ExtensionHost
  const section = prompt(host).sections!.find((item) => item.key === 'building_blocks')!
  const render = (conversationId: number) =>
    section.render({ conversationId } as Parameters<typeof section.render>[0], BACKGROUND_CONTEXT)

  expect(await render(11)).toContain('example: Example capability.')
  expect(await render(11)).not.toContain('active:')
  expect(await render(12)).toBe('')
  expect(await render(13)).toBe('')
  // Omitting the catalogue for another role must not affect the standing agent's next render.
  expect(await render(11)).toContain('/project/.ultimate/settings.json')
  host.extensions = () => []
  expect(await render(11)).toBe('')
})
