import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, expect, it } from 'vitest'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { getCurrentTools } from '@earendil-works/pi-ai/utils/transcript'
import { AgentDoc, defineExtension, defineTool } from '@earendil-works/pi-durable'
import { obj, str } from '@earendil-works/pi-schema'
import type { Conversation, JsonObject } from '@earendil-works/pi-durable'
import { CodingTools } from '@earendil-works/pi-durable/tools'
import { definitionAgent, discoverAgents } from '../../../lib/agents.ts'
import { context, prepareHarness } from '../../../server/harness.ts'
import type { OpenHost } from '../../../server/harness.ts'
import type { ExtensionHost } from '../../../server/extensions.ts'
import { Metadata } from '../../../server/metadata.ts'
import { eventHost, idleNeed, post, temp } from '../../../test/helpers.ts'
import { closeFixtures, fixture as serverFixture } from '../../../test/extension-fixtures.ts'
import automations from '../../automations/server.ts'
import browser from '../../browser/server.ts'
import plan, { Plan } from '../../plan/server.ts'
import { reconfigure } from '../../subagents/children.ts'
import loading from '../server.ts'

afterAll(closeFixtures)
const opened: OpenHost[] = []
afterEach(async () => {
  for (const host of opened.splice(0)) await host.close()
})

async function fixture() {
  const home = await temp('ultimate-lazy-tools-')
  const prepared = await prepareHarness({
    ultimateRoot: home,
    userHome: home,
    home: join(home, 'state'),
    faux: fauxProvider(),
  })
  let host: OpenHost
  const extensionHost = {
    ...prepared,
    ...eventHost(() => host.harness, 'automations'),
    harness: () => host.harness,
    metadata: Metadata,
    need: idleNeed,
    extensions: () => [{ name: 'subagents', enabled: true }],
    projectSetup: async () => ({ decision: false }),
    projectSettings: async () => ({}),
    implement: () => {},
    resource: (_key: string, create: () => unknown) => create(),
    onOpen: () => {},
    onRelease: () => {},
    onClose: () => {},
  } as unknown as ExtensionHost
  const automation = automations(extensionHost)
  const ledger = plan(extensionHost)
  const browserExtension = browser(extensionHost)
  const reads: JsonObject[] = []
  // Keep the real built-in schema; record execution without spawning a browser in a unit test.
  const originalBrowser = {
    ...browserExtension.tools!.find((tool) => tool.name === 'browser')!,
    execute: async (args: JsonObject) => {
      reads.push(args)
      return { output: [{ type: 'text' as const, text: 'Browser read' }] }
    },
  }
  prepared.registry.install(CodingTools)
  prepared.registry.install(
    defineExtension({
      name: 'search-fixture',
      tools: ['grep', 'find'].map((name) =>
        defineTool({
          name,
          description: 'Read-only search fixture',
          parameters: obj({}),
          execute: async () => ({ output: [] }),
        }),
      ),
    }),
  )
  prepared.registry.install(automation)
  prepared.registry.install(ledger)
  prepared.registry.install({
    ...browserExtension,
    tools: browserExtension.tools!.map((tool) =>
      tool.name === 'browser' ? originalBrowser : tool,
    ),
  })
  const policy = await loading(extensionHost)
  prepared.registry.install(policy)
  host = await prepared.open()
  opened.push(host)
  return {
    prepared,
    host,
    home,
    policy,
    reads,
    originalBrowser,
    originals: [automation.tools![0], ledger.tools![0], originalBrowser],
    async reopen() {
      await host.close()
      opened.splice(opened.indexOf(host), 1)
      host = await prepared.open()
      opened.push(host)
      return host
    },
  }
}

const done = () => fauxAssistantMessage('Complete')
const call = (name: string, args: JsonObject) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' })

it('discovers names, loads original schemas on the next request, executes and retains the selection', async () => {
  const f = await fixture()
  f.prepared.faux!.setResponses([done()])
  await (await f.host.root.submit({ type: 'input', content: 'Start' }, context)).wait(context)
  const before = (await f.host.root.context(context)).entries.at(-1)!
  const offered: string[][] = []
  f.prepared.faux!.setResponses([
    (transcript) => {
      const tools = getCurrentTools(transcript.messages)
      offered.push(tools.map((tool) => tool.name))
      const loader = tools.find((tool) => tool.name === 'load_tools')!
      expect(loader.description).toContain('automation manages schedules')
      expect(loader.description).toContain('plan maintains the durable epic/task ledger')
      expect(loader.description).toContain('browser drives web pages and UI')
      return call('load_tools', { names: ['automation', 'plan', 'browser'] })
    },
    (transcript) => {
      const tools = getCurrentTools(transcript.messages)
      offered.push(tools.map((tool) => tool.name))
      for (const original of f.originals)
        expect(tools.find((tool) => tool.name === original.name)).toEqual({
          name: original.name,
          description: original.description,
          parameters: original.parameters,
        })
      return fauxAssistantMessage(
        [
          fauxToolCall('automation', { action: 'list' }),
          fauxToolCall('plan', { action: 'show' }),
          fauxToolCall('browser', { steps: [{ eval: 'document.title' }] }),
        ],
        { stopReason: 'toolUse' },
      )
    },
    done(),
  ])
  await (
    await f.host.root.submit({ type: 'input', content: 'Inspect tools' }, context)
  ).wait(context)
  expect(offered[0]).toContain('load_tools')
  expect(offered[0]).toContain('screenshot')
  for (const name of ['automation', 'plan', 'browser']) expect(offered[0]).not.toContain(name)
  expect(offered[1]).toEqual([...offered[0], 'automation', 'plan', 'browser'])
  expect(f.reads).toEqual([{ steps: [{ eval: 'document.title' }] }])
  expect(
    (await f.host.root.agent(context)).tools.find((tool) => tool.name === 'browser'),
  ).toMatchObject(f.originalBrowser)
  const view = await f.host.root.context(context)
  const results = view.messages.filter((message) => message.role === 'toolResult')
  expect(results.find((result) => result.toolName === 'automation')?.content).toEqual([
    { type: 'text', text: 'None.' },
  ])
  expect(results.map((result) => [result.toolName, result.isError])).toEqual([
    ['load_tools', false],
    ['automation', false],
    ['plan', false],
    ['browser', false],
  ])
  expect(await f.host.harness.snapshot(AgentDoc, f.host.root.id, context)).toMatchObject({
    modelTools: { add: ['automation', 'plan', 'browser'] },
  })
  const after = view.entries.at(-1)!
  const early = await f.host.root.fork(before.id, { ownership: { kind: 'ownerless' } }, context)
  const late = await f.host.root.fork(after.id, { ownership: { kind: 'ownerless' } }, context)
  expect((await early.agent(context)).tools.map((tool) => tool.name)).not.toContain('browser')
  expect((await late.agent(context)).tools.map((tool) => tool.name)).toContain('browser')

  // Enough history to exercise compaction rather than its short-context no-op.
  await f.host.harness.commit(async (tx) => {
    for (let n = 0; n < 8; n++)
      await tx.appendEntry(f.host.root.id, {
        kind: 'pi.user',
        model: [{ role: 'user', content: `Part ${n} ${'word '.repeat(4000)}`, timestamp: n }],
      })
  }, context)
  f.prepared.faux!.setResponses([fauxAssistantMessage('Summary')])
  await f.host.harness.waitForTask(await f.host.root.compact(undefined, context), context)
  expect(
    (await f.host.root.context(context)).entries.some((entry) => entry.kind === 'pi.compaction'),
  ).toBe(true)
  const reopened = await f.reopen()
  f.prepared.faux!.setResponses([call('browser', { steps: [{ eval: 'document.title' }] }), done()])
  await (
    await reopened.root.submit({ type: 'input', content: 'Read again' }, context)
  ).wait(context)
  expect((await reopened.root.agent(context)).tools.map((tool) => tool.name)).toEqual(offered[1])
  expect((await reopened.root.context(context)).messages.at(-2)).toMatchObject({
    role: 'toolResult',
    toolName: 'browser',
    isError: false,
  })
})

it('rejects invalid and atomic denied loads, while explicit roles preload through refresh', async () => {
  const f = await fixture()
  const base = await f.host.root.agent(context)
  const loader = base.tools.find((tool) => tool.name === 'load_tools')!
  const automation = base.deferred.find((tool) => tool.name === 'automation')!
  await f.host.root.configure({ tools: [loader, automation] }, context)
  const invoke = async (args: JsonObject, conversation: Conversation = f.host.root) => {
    f.prepared.faux!.setResponses([call('load_tools', args), done()])
    await (
      await conversation.submit({ type: 'input', content: 'Load tools' }, context)
    ).wait(context)
    return (await conversation.context(context)).messages.at(-2)
  }
  for (const names of [
    ['automation', 'browser'],
    ['automation', 'plan'],
    ['automation', 'debug'],
    [],
  ]) {
    expect(await invoke({ names })).toMatchObject({ role: 'toolResult', isError: true })
    expect((await f.host.root.agent(context)).tools.map((tool) => tool.name)).toEqual([
      'load_tools',
    ])
    expect(await f.host.harness.snapshot(AgentDoc, f.host.root.id, context)).not.toHaveProperty(
      'modelTools',
    )
  }
  const definitions = await discoverAgents(resolve('.'), f.home, f.home, f.prepared.modelRuntime)
  const ultimate = definitions.definitions.find((definition) => definition.name === 'ultimate')!
  const scout = definitions.definitions.find((definition) => definition.name === 'scout')!
  for (let refresh = 0; refresh < 2; refresh++) {
    await f.host.harness.commit(
      (tx) => reconfigure(tx, f.host.root.id, ultimate, base, f.prepared.modelRuntime),
      context,
    )
    const names = (await f.host.root.agent(context)).tools.map((tool) => tool.name)
    expect(names).toContain('automation')
    expect(names).not.toContain('load_tools')
    expect(names).not.toContain('browser')
  }
  const childId = await f.host.harness.commit(async (tx) => {
    const child = await tx.createConversation({ ownership: { kind: 'ownerless' } })
    return child.id
  }, context)
  const readonly = (await f.host.harness.conversation(childId, context))!
  await readonly.configure(definitionAgent(scout, base, f.prepared.modelRuntime), context)
  expect((await readonly.agent(context)).tools.map((tool) => tool.name).toSorted()).toEqual([
    'bash',
    'find',
    'grep',
    'read',
  ])
  expect(await invoke({ names: ['browser'] }, readonly)).toMatchObject({
    role: 'toolResult',
    isError: true,
  })
  expect(await f.host.harness.snapshot(Plan, readonly.id, context)).toBeUndefined()
  await readonly.configure(
    definitionAgent({ ...scout, tools: ['read', 'browser'] }, base, f.prepared.modelRuntime),
    context,
  )
  expect((await readonly.agent(context)).tools.map((tool) => tool.name)).toEqual([
    'read',
    'browser',
  ])
  await readonly.configure(
    definitionAgent({ ...scout, tools: ['read', 'message'] }, base, f.prepared.modelRuntime),
    context,
  )
  expect((await readonly.agent(context)).tools.map((tool) => tool.name)).toEqual(['read'])

  f.prepared.registry.uninstall(f.policy)
  expect((await readonly.agent(context)).tools.map((tool) => tool.name)).not.toContain('automation')
  await f.host.root.configure({ tools: null, modelTools: null }, context)
  expect((await f.host.root.agent(context)).tools.map((tool) => tool.name)).toContain('browser')
})

it('wraps a later user-like browser provider without changing its schema, replay or execution', async () => {
  const f = await fixture()
  const commands: string[] = []
  const original = defineTool({
    name: 'browser',
    description: 'Persistent CLI browser fixture',
    parameters: obj({ command: str() }),
    replay: 'unsafe',
    async execute({ command }) {
      commands.push(command)
      return { output: [{ type: 'text', text: command }] }
    },
  })
  f.prepared.registry.install(defineExtension({ name: 'user-browser-fixture', tools: [original] }))
  expect(
    (await f.host.root.agent(context)).deferred.find((tool) => tool.name === 'browser'),
  ).toMatchObject(original)
  f.prepared.faux!.setResponses([
    call('load_tools', { names: ['browser', 'browser'] }),
    (transcript) => {
      expect(getCurrentTools(transcript.messages).find((tool) => tool.name === 'browser')).toEqual({
        name: original.name,
        description: original.description,
        parameters: original.parameters,
      })
      return call('browser', { command: 'snapshot' })
    },
    done(),
  ])
  await (
    await f.host.root.submit({ type: 'input', content: 'Read browser' }, context)
  ).wait(context)
  expect(commands).toEqual(['snapshot'])
  const before = await f.host.harness.snapshot(AgentDoc, f.host.root.id, context)
  f.prepared.faux!.setResponses([call('load_tools', { names: ['browser', 'browser'] }), done()])
  await (
    await f.host.root.submit({ type: 'input', content: 'Already loaded' }, context)
  ).wait(context)
  expect(await f.host.harness.snapshot(AgentDoc, f.host.root.id, context)).toEqual(before)
  const loaded = (await f.host.root.agent(context)).tools.find((tool) => tool.name === 'browser')!
  expect(loaded).toMatchObject(original)
  f.prepared.registry.uninstall(f.policy)
  expect((await f.host.root.agent(context)).tools.find((tool) => tool.name === 'browser')).toBe(
    original,
  )
})

it('layers trusted settings live, keeps last-good on invalid reload, and supports an empty policy', async () => {
  const { home, projectRoot, server } = await serverFixture(
    JSON.stringify({ lazyTools: ['browser'] }),
  )
  const userFile = join(home, '.ultimate/settings.json')
  const projectDir = join(projectRoot, '.ultimate')
  await mkdir(projectDir)
  await writeFile(join(projectDir, 'settings.json'), JSON.stringify({ lazyTools: ['plan'] }))
  const setEnabled = async (enabled: boolean) => {
    const response = await post(server, '/api/extensions/onboarding/actions/setExtension', {
      args: { name: 'lazy-tools', enabled, scope: 'user' },
      conversationId: server.root.id,
    })
    expect(response.status).toBe(200)
  }
  const deferred = async () => (await server.root.agent(context)).deferred.map((tool) => tool.name)
  expect(await deferred()).toContain('browser')
  expect(await deferred()).not.toContain('plan')
  const local = async (value: boolean) => {
    const response = await post(server, '/api/extensions/onboarding/actions/decide', {
      args: { local: value },
      conversationId: server.root.id,
    })
    expect(response.status).toBe(200)
  }
  await local(true)
  expect(await deferred()).toContain('plan')
  expect(await deferred()).not.toContain('browser')
  await local(false)
  expect(await deferred()).toContain('browser')
  await writeFile(userFile, JSON.stringify({ lazyTools: ['browser', 'browser', 'plan'] }))
  await setEnabled(true)
  const declaration = JSON.stringify(server.host.registry.snapshot().extension('lazy-tools')!.tools)
  await writeFile(userFile, JSON.stringify({ lazyTools: ['plan', 'browser'] }))
  await setEnabled(true)
  expect(JSON.stringify(server.host.registry.snapshot().extension('lazy-tools')!.tools)).toBe(
    declaration,
  )
  await writeFile(userFile, JSON.stringify({ lazyTools: ['message'] }))
  await setEnabled(true)
  expect(server.extensions.info().find((e) => e.name === 'lazy-tools')!.server!.error).toContain(
    'lazyTools',
  )
  expect(await deferred()).toContain('browser')
  await writeFile(userFile, JSON.stringify({ lazyTools: [] }))
  await setEnabled(true)
  expect(
    server.extensions.info().find((e) => e.name === 'lazy-tools')!.server!.error,
  ).toBeUndefined()
  const eager = await server.root.agent(context)
  expect(eager.tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(['automation', 'plan', 'browser']),
  )
  expect(eager.tools.map((tool) => tool.name)).not.toContain('load_tools')
})

it('reports invalid startup policy and recovers by an explicit disable-enable after correction', async () => {
  const { home, server } = await serverFixture(JSON.stringify({ lazyTools: null }))
  const entry = () => server.extensions.info().find((e) => e.name === 'lazy-tools')!
  expect(entry().server!.error).toContain('lazyTools')
  const setEnabled = async (enabled: boolean) => {
    const response = await post(server, '/api/extensions/onboarding/actions/setExtension', {
      args: { name: 'lazy-tools', enabled, scope: 'user' },
      conversationId: server.root.id,
    })
    expect(response.status).toBe(200)
  }
  await writeFile(join(home, '.ultimate/settings.json'), JSON.stringify({ lazyTools: ['browser'] }))
  await setEnabled(true)
  expect(entry().server!.error).toContain('lazyTools')
  await setEnabled(false)
  await setEnabled(true)
  expect(entry().server!.error).toBeUndefined()
  expect((await server.root.agent(context)).deferred.map((tool) => tool.name)).toContain('browser')
})
