import type { Agent } from '@earendil-works/pi-durable'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { definitionAgent } from '../lib/agents.ts'
import { definitionRuns, mergeFamilies, parseFamilies } from '../lib/families.ts'
import type { FamilySpec } from '../lib/families.ts'
import { readFamilies, readFamilyLayers, writeFamilies } from '../lib/families-settings.ts'
import { temp } from './helpers.ts'

const families = (value: unknown, project?: unknown) =>
  mergeFamilies(parseFamilies(value), parseFamilies(project))

it('runs a definition on its pin, else its family, else the default family', () => {
  const config = families({
    families: { fast: { model: 'acme/quick' }, local: { model: 'vllm/current', thinking: 'low' } },
    // An agent's family lives in its definition: an old settings assignment no longer moves it.
    assign: { 'agent/worker': 'local' },
  })
  const pin = { provider: 'acme', modelId: 'big' }
  expect(definitionRuns({ family: 'fast' }, config)).toEqual({
    family: 'fast',
    model: { provider: 'acme', modelId: 'quick' },
    via: 'family',
  })
  expect(definitionRuns({ model: pin, family: 'fast' }, config)).toEqual({
    model: pin,
    via: 'pin',
  })
  // The family's thinking applies unless the definition sets its own.
  expect(definitionRuns({ family: 'local' }, config).thinking).toBe('low')
  expect(definitionRuns({ family: 'local', thinking: 'max' }, config).thinking).toBe('max')
  // The default family runs the parent's model; an unknown family falls back to it.
  expect(definitionRuns({}, config)).toEqual({ family: 'default', via: 'family' })
  expect(definitionRuns({ family: 'gone' }, config)).toEqual({
    family: 'default',
    via: 'family',
  })
})

it('moves the same agent and its instructions when only its family model and thinking change', () => {
  // Families are configuration and `definitionRuns`/`definitionAgent` are what a start or a branch configures from, so
  // a family swap is provable without a provider call: no model is asked anything here.
  const available = [
    { provider: 'acme', id: 'quick' },
    { provider: 'acme', id: 'brisk' },
  ]
  const runtime = {
    getAvailableSnapshot: () => available,
    // Routing is what is asserted; clamping a level to a model's support is Pi's.
    getModel: () => undefined,
  } as unknown as ModelRuntime
  const worker = {
    name: 'worker',
    description: 'Implement one bounded task',
    path: 'worker.md',
    instructions: 'Implement the task, verify it and report evidence.',
    family: 'fast',
  }
  const parent = {
    tools: [],
    deferred: [],
    extensions: [],
    model: { provider: 'acme', modelId: 'lead' },
    thinkingLevel: 'medium',
  } as unknown as Agent
  const run = (fast: FamilySpec) => {
    const runs = definitionRuns(worker, mergeFamilies(parseFamilies({ families: { fast } })))
    return { runs, agent: definitionAgent({ ...worker, runs }, parent, runtime) }
  }
  const first = run({ model: 'acme/quick', thinking: 'low' })
  expect(first.runs).toEqual({
    family: 'fast',
    model: { provider: 'acme', modelId: 'quick' },
    thinking: 'low',
    via: 'family',
  })
  expect(first.agent).toMatchObject({
    model: { provider: 'acme', modelId: 'quick' },
    thinkingLevel: 'low',
    instructions: worker.instructions,
  })
  // Only the family's preset moved: the same definition runs on the new model and thinking level, instructions intact,
  // and still by family rather than by a pin.
  const second = run({ model: 'acme/brisk', thinking: 'high' })
  expect(second.runs).toMatchObject({ family: 'fast', via: 'family' })
  expect(second.agent).toMatchObject({
    model: { provider: 'acme', modelId: 'brisk' },
    thinkingLevel: 'high',
    instructions: worker.instructions,
  })
  expect(second.agent.instructions).toBe(first.agent.instructions)
})

it('merges the project over the user over the built-ins, field by field', () => {
  const config = families(
    { families: { tiny: { model: 'acme/mini' }, local: { model: 'vllm/current' } } },
    { families: { tiny: { thinking: 'high' } } },
  )
  expect(config.families.tiny).toEqual({ model: 'acme/mini', thinking: 'high', color: 'emerald' })
  expect(config.families.local.model).toBe('vllm/current')
  expect(config.families.local.color).toBeTruthy()
  expect(() => parseFamilies({ families: { Bad: {} } })).toThrow('lowercase')
})

it("keeps each project's families and starts a project without its own from the ones saved last", async () => {
  const userHome = await temp('ultimate-families-')
  const [a, b, c] = ['a', 'b', 'c'].map((name) => join(userHome, name))
  for (const root of [a, b, c]) await mkdir(root)
  const tiny = async (root: string) =>
    (await readFamilyLayers(userHome, root, {})).from +
    ' ' +
    (await readFamilies(userHome, root, {})).families.tiny.model
  expect(await tiny(a)).toBe('builtin openai-codex/gpt-6-luna')
  await writeFamilies(userHome, a, { families: { tiny: { model: 'vllm/a' } } })
  await writeFamilies(userHome, b, { families: { tiny: { model: 'vllm/b' } } })
  // Each keeps its own; a project that never saved starts from the last save, b's.
  expect(await tiny(a)).toBe('project vllm/a')
  expect(await tiny(b)).toBe('project vllm/b')
  expect(await tiny(c)).toBe('recent vllm/b')
  // The project's team settings apply over the most recent families, and its own families apply over them.
  const team = { modelFamilies: { families: { tiny: { model: 'acme/team' } } } }
  expect((await readFamilies(userHome, c, team)).families.tiny.model).toBe('acme/team')
  expect((await readFamilies(userHome, a, team)).families.tiny.model).toBe('vllm/a')
})
