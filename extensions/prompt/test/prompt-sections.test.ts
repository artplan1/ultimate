import { expect, it } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ExtensionHost } from '../../../server/extensions.ts'
import prompt from '../server.ts'

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
