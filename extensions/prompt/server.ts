import { parseConversationId } from '../../lib/ids.ts'
import type { ConversationId, Tx } from '@earendil-works/pi-durable'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { formatSkillsForPrompt, loadProjectContextFiles } from '@earendil-works/pi-coding-agent'
import {
  AgentDoc,
  configure,
  defineDoc,
  defineExtension,
  GenerationTask,
  hook,
  ROOT_CONVERSATION_ID,
  section,
} from '@earendil-works/pi-durable'
import type { ExtensionHost } from '../../server/extensions.ts'
import type { ConversationSummary } from '../../shared/protocol.ts'
import { discoverAgents } from '../../lib/agents.ts'
import { git } from '../../lib/git.ts'
import { ignoring, isMissing, meansNone } from '../../lib/errors.ts'
import { shortTitle } from '../../lib/title.ts'
import { Standing } from '../subagents/api.ts'
import type { BuildNote, Landing } from './refs.ts'

export const order = -100

/**
 * The build a conversation's last run started on and the clone's commit then (`head`); a fork starts from its parent's.
 * For the primary agent also the hashes of the instruction files it last saw (`files`, path → sha256 prefix).
 */
const SeenBuild = defineDoc<{ id?: string; head?: string; files?: Record<string, string> }>({
  kind: 'prompt.build',
  checkpointWhen: () => false,
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'current',
  initial: () => ({}),
})
export const docs = [SeenBuild]

/**
 * What changed since build `seen`: the changes of every later build in this process, or nothing when it is older, and
 * what landed meanwhile.
 */
export function buildNote(
  build: ReturnType<ExtensionHost['build']>,
  seen: string,
  landed: Landing[] = [],
) {
  const since = build.history.findIndex((entry) => entry.id === seen)
  const changed =
    since < 0 ? [] : [...new Set(build.history.slice(since + 1).flatMap((entry) => entry.changed))]
  return (
    `Build changed: ${seen} → ${build.id} · generation ${build.generation}` +
    (changed.length ? ` · changed: ${changed.join(', ')}` : '') +
    (landed.length
      ? ` · landed: ${landed.map((row) => (row.conversation ? `${row.title} (#${row.conversation})` : `${row.title} (${row.sha.slice(0, 7)})`)).join(', ')}`
      : '')
  )
}

/**
 * The landings in the clone from commit `from` to `to`, newest first: one row per branch, named by its title, else by
 * its newest commit's subject. A commit names its conversation by trailer, a lander merge in its subject; a
 * subagent's commit counts for the branch that owns it. A commit without either is a row of its own.
 */
export async function landings(
  cwd: string,
  from: string,
  to: string,
  conversations: ConversationSummary[],
): Promise<Landing[]> {
  const log = await git(
    cwd,
    'log',
    '--first-parent',
    '-n',
    '200',
    '--format=%H%x00%s%x00%(trailers:key=Ultimate-Conversation,valueonly)%x1e',
    `${from}..${to}`,
  )
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]))
  const rows = new Map<string, Landing>()
  for (const record of log.split('\x1e')) {
    const [sha, subject, trailer] = record.trim().split('\0')
    if (!sha) continue
    let id =
      parseConversationId(
        Number(trailer?.trim()) || Number(/ from #(\d+) into /.exec(subject)?.[1]),
      ) || undefined
    // An owned conversation (a worker, a designer) worked for its owner's branch.
    for (let owner = id && byId.get(id)?.parentConversationId; owner;) {
      id = owner
      owner = byId.get(owner)?.parentConversationId
    }
    const key = id ? `#${id}` : sha
    if (rows.has(key)) continue
    const title = id && byId.get(id)?.title
    rows.set(key, {
      ...(id ? { conversation: id } : {}),
      title: title ? shortTitle(title) : subject,
      sha,
    })
  }
  return [...rows.values()]
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Ultimate's own docs the primary agent reads on demand, by absolute path: `AGENTS.md`, `docs/*.md`, `agents/*.md`. */
async function cloneDocs(ultimateRoot: string, files: Record<string, string>) {
  const listed = async (folder: string) =>
    // A missing folder lists nothing.
    (await readdir(join(ultimateRoot, folder)).catch(() => [] as string[]))
      .filter((name) => name.endsWith('.md'))
      .map((name) => join(ultimateRoot, folder, name))
  const paths = [
    join(ultimateRoot, 'AGENTS.md'),
    ...(await listed('docs')),
    ...(await listed('agents')),
  ]
  for (const path of paths) {
    const text = await readFile(path, 'utf8').catch(ignoring(isMissing))
    if (text !== undefined) files[path] = digest(text)
  }
}

/**
 * `path` as the agent knows it: relative to the project, or to the clone (`Ultimate/…` when the clone is another
 * folder), else with the home as `~`.
 */
function shown(host: ExtensionHost, path: string) {
  const inProject = relative(host.projectRoot, path)
  if (!inProject.startsWith('..')) return inProject
  const inClone = relative(host.ultimateRoot, path)
  if (!inClone.startsWith('..')) return `Ultimate/${inClone}`
  return path.startsWith(host.userHome) ? `~${path.slice(host.userHome.length)}` : path
}

/**
 * For the primary agent (@ultimate): re-apply its definition's instructions when they
 * differ from the conversation's, and name the instruction files that changed since its last run. Other agents keep
 * the instructions they started with.
 */
async function instructionChanges(
  host: ExtensionHost,
  tx: Tx,
  conversationId: ConversationId,
  seen: { files?: Record<string, string> },
) {
  const name = 'ultimate'
  if ((await tx.doc(Standing, ROOT_CONVERSATION_ID))[name] !== conversationId)
    return { instructions: [], docs: [] }
  const { definitions } = await discoverAgents(
    host.ultimateRoot,
    host.projectRoot,
    host.userHome,
    host.modelRuntime,
  )
  const definition = definitions.find((candidate) => candidate.name === name)
  // Messages deliveries refresh a standing agent; a typed input did not, so an updated definition waited for a message.
  const reapplied =
    definition !== undefined &&
    (await tx.doc(AgentDoc, conversationId)).instructions !== definition.instructions
  if (reapplied) await configure(tx, conversationId, { instructions: definition.instructions })
  // Keyed by absolute path, so the project's and the clone's AGENTS.md stay apart (and are one file when the clone is
  // the project).
  const files: Record<string, string> = {}
  await cloneDocs(host.ultimateRoot, files)
  for (const file of loadProjectContextFiles({
    cwd: host.projectRoot,
    agentDir: join(host.userHome, '.ultimate'),
  }))
    files[file.path] = digest(file.content)
  // The file was just parsed; one removed since then hashes as empty and counts as changed.
  const own = definition ? [definition.path, ...(definition.overlays ?? [])] : []
  for (const path of own) files[path] = digest(await readFile(path, 'utf8').catch(() => ''))
  const previous = seen.files
  seen.files = files
  // The first run records what it saw; afterwards every added, changed or removed file counts.
  const changed = previous
    ? [...new Set([...Object.keys(previous), ...Object.keys(files)])]
        .filter((path) => previous[path] !== files[path])
        .toSorted()
    : []
  // The definition's files (its own and any overlays) are named as instructions when they changed; a text re-applied
  // here with no file changed since the last run (a Messages delivery applied it already) names the definition's own
  // file. An overlay removed since the last run is found by its file name.
  const ownFile = `/agents/${name}.md`
  const touched = changed.filter((path) => own.includes(path) || path.endsWith(ownFile))
  const instructions = (touched.length || !reapplied ? touched : own.slice(0, 1)).map((path) =>
    path in files ? shown(host, path) : `${shown(host, path)} (removed)`,
  )
  const named = changed
    .filter((path) => !touched.includes(path))
    .map((path) => (path in files ? shown(host, path) : `${shown(host, path)} (removed)`))
  return { instructions, docs: named }
}

/** The note's text: what changed, so the agent knows its instructions or Ultimate's docs moved. */
export function instructionNote(changes: { instructions: string[]; docs: string[] }) {
  return [
    changes.instructions.length > 0 &&
      `Instructions changed: ${changes.instructions.join(', ')}. Your system prompt now carries the new text; drop habits from the old one.`,
    changes.docs.length > 0 &&
      `Docs changed: ${changes.docs.join(', ')}. Re-read them before relying on what you read earlier.`,
  ]
    .filter(Boolean)
    .join('\n')
}

export default function prompt(host: ExtensionHost) {
  return defineExtension({
    name: 'prompt',
    hooks: [
      // Pi upstream: @earendil-works/pi-durable@1.5.2 — patched transactional beforeInput hook.
      // The build is a note on the input that starts a run, not a system-prompt section: every hot reload changed that
      // section, and a changed system prompt rewrites the whole prompt cache. A conversation's first run records it.
      hook(GenerationTask, {
        beforeInput: async (_input, { tx, conversationId }) => {
          const build = host.build()
          const seen = await tx.doc(SeenBuild, conversationId)
          const changes = await instructionChanges(host, tx, conversationId, seen)
          const previous = seen.id
          seen.id = build.id
          const built = previous !== undefined && previous !== build.id
          let landed: Landing[] = []
          if (seen.head === undefined || built) {
            const head = await git(host.ultimateRoot, 'rev-parse', 'HEAD').catch(meansNone)
            if (built && head && seen.head && head !== seen.head)
              landed = await landings(
                host.ultimateRoot,
                seen.head,
                head,
                host.conversations(),
              ).catch(
                // A seen commit no longer in the clone (history rewritten) names nothing.
                () => [],
              )
            if (head) seen.head = head
          }
          const text = [built && buildNote(build, previous, landed), instructionNote(changes)]
            .filter(Boolean)
            .join('\n')
          if (!text) return undefined
          const data: BuildNote = {
            ...(built && { from: previous, to: build.id }),
            ...(landed.length > 0 && { landed }),
            ...(changes.instructions.length > 0 && { instructions: changes.instructions }),
            ...(changes.docs.length > 0 && { docs: changes.docs }),
          }
          return {
            entries: [
              {
                kind: 'prompt.build',
                data: { ...data },
                model: [{ role: 'user' as const, content: text, timestamp: Date.now() }],
              },
            ],
          }
        },
      }),
    ],
    sections: [
      section(
        'identity',
        () =>
          `You are Ultimate, a coding agent running in a web UI on the user's machine. The person in this conversation steers; you build, verify, and report.`,
      ),
      section(
        'principles',
        () => `- Questions and assessment requests: investigate, recommend one approach with a material risk, simpler path or overlooked case, then wait for go before changing anything. Clear instructions, delegated tasks and scheduled runs authorize implementation unless assessment was requested: do it, verify, report. Ask only unresolved behaviour/scope decisions, through your role's decision flow.
- Read relevant code, run it and inspect existing UI before changing it. Ground claims in files, command output, tests or screenshots.
- Question the need; reuse existing code, platform features and installed dependencies. Make the smallest required change; no speculative abstractions, compatibility shims or fallbacks for nonexistent situations.
- Iterate in small steps, checking tests or the running app before proceeding. Never claim unverified success; report failed checks with output and say what you skipped.
- Match neighbouring code and UI: clean, consistent, quiet. Leave things better within scope. Verify rendered UI; user-visible outcomes get distinct existing-style cards, not raw text. Apply user corrections to similar cases.
- Recommend one option and surface material tradeoffs.`,
      ),
      section('self_awareness', (input) => {
        const tools = input.agent.tools ?? []
        const has = (name: string) => tools.some((tool) => tool.name === name)
        return [
          'This durable conversation continues across tasks, compactions and restarts. Compaction summarizes older context as the window fills; full history stays stored.' +
            (has('codemode') ? ' Search it with `ultimate.search()` in codemode.' : ''),
          'Steering arrives after a tool round; follow-ups start the next run. Act on delivered inputs immediately, never on queued `pi.inbox` inputs before delivery: they would arrive again.',
          'Each step is a durable task, resumed from its last checkpoint after a crash/restart. Interrupted tools may have completed: inspect effects before retrying.',
          ...(has('subagent')
            ? ['Subagents have separate contexts: give them self-contained tasks.']
            : []),
          'A "Build changed" note means a hot swap of tools, prompt or UI: inspect its changed list and `git log`/`git diff`' +
            (has('codemode') ? ', `ultimate.extensions()`' : '') +
            '; verify changed behaviour before relying on it. "Instructions changed" is already reflected in your prompt; re-read files named by "Docs changed" before relying on them.',
        ].join('\n')
      }),
      // Pi upstream: @earendil-works/pi-coding-agent@1.5.2 src/core/system-prompt.ts and src/core/tools/*.ts — copied tool guidance adapted from unexported prompt contributions. Drop when Pi exports buildSystemPromptSections and the per-tool system prompt contributions.
      section('tools', (input) => {
        const guidance: Record<string, string> = {
          grep: '- Content lookups use grep, never shell rg/grep; narrow path/glob and bound context/limit.',
          find: '- File lookups use find, never shell find/fd/ls; narrow path/glob.',
          bash: '- Poll/wait with interruptible: true so steering can end it; each sleep ≤30 s. Never combine waiting and state-changing commands in one call. Truncated output is saved to a file: read it for the full output.',
          edit: '- Keep edits small; batch changes to one file in one call. After "Could not find", re-read the region; after "Found N occurrences", widen oldText with surrounding lines before retrying.',
        }
        const names = new Set((input.agent.tools ?? []).map((tool) => tool.name))
        return [
          ...[...names].flatMap((name) => (guidance[name] ? [guidance[name]] : [])),
          ...(names.has('bash') && names.has('read') && names.has('edit') && names.has('write')
            ? [
                '- Use dedicated read/edit/write tools, not shell commands or scripts, to read/change/create files: their diffs and exact-match checks make changes reviewable. For renames across a few files, edit each file. Bash is allowed for generated output (formatters, codegen, package managers) or mechanical changes across many files, not file/content lookup when grep/find can do it.',
              ]
            : []),
          '- Web UI responses use Markdown: short paragraphs, lists, language-tagged code fences and backticked paths.',
        ].join('\n')
      }),
      section('project_context', (input) =>
        loadProjectContextFiles({
          cwd: input.env?.cwd ?? input.agent.cwd ?? host.projectRoot,
          agentDir: join(host.userHome, '.ultimate'),
        })
          .map(
            (file) =>
              `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`,
          )
          .join('\n\n'),
      ),
      section('skills', (input) => {
        const skills = host.skills(input.env?.cwd ?? input.agent.cwd ?? host.projectRoot)
        // As Pi's buildSystemPromptSections: name the tool the agent can load a skill with, and list none without one.
        const names = new Set((input.agent.tools ?? []).map((tool) => tool.name))
        const reader = (['read', 'bash'] as const).find((name) => names.has(name))
        const listed = reader ? formatSkillsForPrompt(skills, reader).trim() : ''
        return listed
          ? `${listed}\nWhen a task matches a listed skill, read it before you start; it carries the steps the project expects.`
          : undefined
      }),
      // Empty, not undefined, when nothing is off: the slot keeps its place, so coming back patches only this section
      // (Pi re-sends every section when one would land out of order, #573861).
      section(
        'building_blocks',
        async (input, context) => {
          const standing = await host.harness().snapshot(Standing, ROOT_CONVERSATION_ID, context)
          if (standing?.ultimate !== input.conversationId) return ''
          const off = host.extensions().filter((extension) => !extension.enabled)
          if (!off.length) return ''
          // Folders come from discovery, so external extensions are listed where they really are.
          const folders = new Map<string, string[]>()
          for (const extension of off) {
            const sentence = extension.readme
              ?.trim()
              .split(/(?<=[.!?])\s/)[0]
              ?.replace(/\s+/g, ' ')
            const folder = dirname(extension.path)
            folders.set(folder, [
              ...(folders.get(folder) ?? []),
              `${extension.name}: ${sentence ?? ''}`,
            ])
          }
          return [
            '<building_blocks>',
            'Available but off, by the folder each one is in; its README.md says what it does:',
            ...[...folders].map(([folder, names]) => `- ${folder}/: ${names.join('; ')}`),
            'Enable names with "extensions": { "enable": [...] } in ~/.ultimate/settings.json (this machine) or <project>/.ultimate/settings.json (the host project). Changes apply live with no restart.',
            `The running host uses ${host.projectRoot}/.ultimate/settings.json and ${host.projectRoot}/.ultimate/extensions/; editing these in a separate work checkout does not change the host's configuration or hot-reload its extensions.`,
            '</building_blocks>',
          ].join('\n')
        },
        { tag: false },
      ),
      section('environment', (input) => {
        const cwd = input.env?.cwd ?? input.agent.cwd ?? host.projectRoot
        const os = process.platform === 'darwin' ? 'macOS' : process.platform
        return `OS: ${os} ${process.arch}\nWork checkout (effective cwd): ${cwd}\nHost project: ${host.projectRoot}\nRunning Ultimate host: ${host.ultimateRoot}\nUI: ${host.system().process.url} (shared host)\nDirect project edits to the effective cwd. Host-scoped config and extensions remain loaded from the host project and Ultimate clone; edits in a separate checkout do not hot-reload the running host.`
      }),
      section('cwd', (input) => input.env?.cwd ?? input.agent.cwd ?? host.projectRoot),
    ],
  })
}
