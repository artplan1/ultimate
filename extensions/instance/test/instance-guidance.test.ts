import { expect, it, vi } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import instance from '../server.ts'
import { temp } from '../../../test/helpers.ts'

it('reads preview configuration and gives lifecycle guidance only with the instance tool', async () => {
  const home = await temp()
  type Host = Parameters<typeof instance>[0]
  const settings = vi.fn<Host['projectSettings']>(async () => ({ instance: { model: null } }))
  const host = {
    need: vi.fn<Host['need']>(),
    want: vi.fn<Host['want']>(),
    implement: vi.fn<Host['implement']>(),
    resource: <T>(_name: string, create: () => T) => create(),
    onClose() {},
    onOpen() {},
    ultimateRoot: '/ultimate',
    projectRoot: '/ultimate',
    userHome: home,
    projectSettings: settings,
  } as unknown as Parameters<typeof instance>[0]
  const section = instance(host).sections![0]
  const render = (names: string[]) =>
    section.render(
      { agent: { tools: names.map((name) => ({ name })) } } as unknown as Parameters<
        typeof section.render
      >[0],
      BACKGROUND_CONTEXT,
    )

  expect(await render(['read', 'grep', 'find', 'bash'])).toBeUndefined()
  expect(settings).not.toHaveBeenCalled()
  expect(await render(['instance'])).toContain('Before restarting after core changes')
  expect(await render(['instance'])).toContain('the configured models')
  expect(await render(['instance'])).toContain('then stop it')
})
