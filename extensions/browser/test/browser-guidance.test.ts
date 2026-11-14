import { expect, it, vi } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ExtensionHost } from '../../../server/extensions.ts'
import browser from '../server.ts'

it('gives visual verification guidance only to agents with browser capabilities', async () => {
  const host = {
    resource: <T>(_name: string, create: () => T) => create(),
    onClose() {},
    onOpen() {},
    need: vi.fn<ExtensionHost['need']>(),
    implement: vi.fn<ExtensionHost['implement']>(),
  } as unknown as ExtensionHost
  const section = browser(host).sections![0]
  const render = (names: string[], deferred: string[] = []) =>
    section.render(
      {
        agent: {
          tools: names.map((name) => ({ name })),
          deferred: deferred.map((name) => ({ name })),
        },
      } as unknown as Parameters<typeof section.render>[0],
      BACKGROUND_CONTEXT,
    )

  expect(await render(['read', 'grep', 'find', 'bash'])).toBeUndefined()
  expect(await render(['read'], ['plan'])).toBeUndefined()
  for (const name of ['browser', 'screenshot']) {
    for (const text of [await render([name]), await render(['read'], [name])]) {
      expect(text).toContain('After UI changes')
      expect(text).toContain('Omit path')
    }
  }
})
