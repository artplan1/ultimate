import { arr, obj } from '@earendil-works/pi-schema'
import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { strEnum } from '../../lib/schema.ts'
import { readSettings, userSettingsPath } from '../../lib/settings.ts'
import type { ExtensionHost } from '../../server/extensions.ts'

const purposes = {
  automation: 'automation manages schedules, event watches and subscriptions',
  plan: 'plan maintains the durable epic/task ledger',
  browser: 'browser drives web pages and UI',
} as const
const supported = Object.keys(purposes) as (keyof typeof purposes)[]

export const reloadOnSettings = true

export default async function lazyTools(host: Pick<ExtensionHost, 'userHome' | 'projectSettings'>) {
  const user = await readSettings(userSettingsPath(host.userHome))
  const project = await host.projectSettings()
  const value = Object.hasOwn(project, 'lazyTools')
    ? project.lazyTools
    : Object.hasOwn(user, 'lazyTools')
      ? user.lazyTools
      : supported
  if (
    !Array.isArray(value) ||
    value.some(
      (name) => typeof name !== 'string' || !supported.includes(name as keyof typeof purposes),
    )
  )
    throw new Error('lazyTools must be an array containing only automation, plan or browser')
  // Canonical order makes equivalent settings produce the same declarations.
  const names = supported.filter((name) => value.includes(name))
  return defineExtension({
    name: 'lazy-tools',
    // Deferral and discovery travel together; disabling this extension restores eager tools.
    wraps: names.map((name) => ({
      tool: name,
      wrap: (tool: ToolRegistration) => ({ ...tool, deferred: true as const }),
    })),
    tools: names.length
      ? [
          defineTool({
            name: 'load_tools',
            description:
              `Load optional tools for your next model call: ${names.map((name) => purposes[name]).join('; ')}. ` +
              'Pass their names here before calling them. Existing role permissions still apply. Call this tool directly, not from codemode.',
            parameters: obj({ names: arr(strEnum(names), { minItems: 1 }) }),
            callers: ['model'],
            // Loading only records offered tool names; repeating it cannot execute the tools.
            replay: 'safe',
            async execute({ names: requested }, api, context) {
              const agent = await api.agent(context)
              const selected = [...new Set(requested)]
              const enabled = [...agent.tools, ...agent.deferred]
              for (const name of selected)
                if (!enabled.some((tool) => tool.name === name))
                  throw new Error(`Tool ${name} is not available to this conversation`)
              const loaded = selected.filter((name) =>
                agent.deferred.some((tool) => tool.name === name),
              )
              return {
                output: [
                  { type: 'text', text: `Available from your next call: ${selected.join(', ')}.` },
                ],
                details: { loaded },
                ...(loaded.length ? { control: { addTools: loaded } } : {}),
              }
            },
          }),
        ]
      : [],
  })
}
