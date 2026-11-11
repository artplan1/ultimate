/**
 * Papercuts: the small frictions agents hit while working, recorded at the moment they happen on the root conversation,
 * so the next dream's failures pass starts from a list instead of a search through every entry.
 */
import { int, obj, opt, str } from '@earendil-works/pi-schema'
import {
  defineDoc,
  defineExtension,
  defineTool,
  ROOT_CONVERSATION_ID,
} from '@earendil-works/pi-durable'
import type { Tx } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context'
import { implementAction } from '../../lib/actions.ts'
import { formatAgo } from '../../lib/ago.ts'
import { strEnum } from '../../lib/schema.ts'
import type { ExtensionHost } from '../../server/extensions.ts'
import { ListAction, PapercutDoc } from './refs.ts'
import type { Closing, Papercut, PapercutKind } from './refs.ts'

/** What kind of friction it was, as the tool offers them. */
export const KINDS = [
  'tool',
  'instruction',
  'harness',
  'environment',
  'model',
  'slow',
] as const satisfies readonly PapercutKind[]
/** Why a row was closed. */
export const CLOSINGS = ['fixed', 'noise', 'superseded'] as const satisfies readonly Closing[]

/** Rows kept, open or closed: the newest. An older one's conversation entry stays the record. */
export const ROWS = 100
export const WHAT_CHARS = 280
export const WHERE_CHARS = 120
export const FIX_CHARS = 200
export const REF_CHARS = 120
/** A row open this long without a repeat is offered for closing by the dream's failures pass. */
export const STALE_MS = 30 * 24 * 60 * 60 * 1000

export const Papercuts = defineDoc<{ next: number; rows: Papercut[] }>({
  kind: PapercutDoc.kind,
  checkpointWhen: () => false,
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ next: 1, rows: [] }),
})
export const docs = [Papercuts]

/** A row as plain JSON: a document overlay is unusable once its transaction settles. */
const copy = (row: Papercut): Papercut => JSON.parse(JSON.stringify(row))

/** A row is one line: whitespace collapses, so a list stays a list. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

const limited = (name: string, value: unknown, max: number) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  const text = oneLine(value)
  if (!text) return undefined
  if (text.length > max) throw new Error(`${name} must be at most ${max} characters`)
  return text
}

/**
 * What makes two raises the same friction: kind and where. Without a where, the start of the words it uses, so twenty
 * branches' "max one failing lookup" stays one row instead of twenty.
 */
export function keyOf(row: Pick<Papercut, 'kind' | 'where' | 'what'>) {
  const where = row.where ? oneLine(row.where).toLowerCase() : ''
  if (where) return `${row.kind} · ${where}`
  const start = oneLine(row.what)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 6)
    .join(' ')
  return `${row.kind} · ${start}`
}

export type RaiseInput = {
  what: string
  kind: PapercutKind
  where?: string
  fix?: string
  conversation: number
  by: string
  cwd: string
}
/** A raise's row, whether it counted an open one up, and how many oldest rows the cap dropped. */
export type Raised = { row: Papercut; repeat: boolean; dropped: number }

/** Raise one, or count up the open row with the same kind and where. */
export async function raise(tx: Tx, input: RaiseInput): Promise<Raised> {
  const what = limited('what', input.what, WHAT_CHARS)
  if (!what) throw new Error('what must say the friction in one line')
  if (!KINDS.includes(input.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`)
  const where = limited('where', input.where, WHERE_CHARS)
  const fix = limited('fix', input.fix, FIX_CHARS)
  const papercuts = await tx.doc(Papercuts, ROOT_CONVERSATION_ID)
  const key = keyOf({ kind: input.kind, where, what })
  const open = papercuts.rows.find((row) => row.status === 'open' && keyOf(row) === key)
  if (open) {
    open.count++
    return { row: copy(open), repeat: true, dropped: 0 }
  }
  const row: Papercut = {
    id: papercuts.next++,
    at: Date.now(),
    conversation: input.conversation,
    by: input.by,
    cwd: input.cwd,
    kind: input.kind,
    what,
    ...(where ? { where } : {}),
    ...(fix ? { fix } : {}),
    count: 1,
    status: 'open',
  }
  papercuts.rows.push(row)
  const dropped = Math.max(0, papercuts.rows.length - ROWS)
  if (dropped) papercuts.rows.splice(0, dropped)
  return { row: copy(row), repeat: false, dropped }
}

/** Close row `id`: fixed, noise or superseded; `fixed` needs the commit or memory slug that fixed it. */
export async function resolve(tx: Tx, id: unknown, how: Closing, ref?: unknown) {
  if (!CLOSINGS.includes(how)) throw new Error(`how must be one of ${CLOSINGS.join(', ')}`)
  const reference = limited('ref', ref, REF_CHARS)
  if (how === 'fixed' && !reference)
    throw new Error('resolve fixed needs ref: the commit or memory slug that fixed it')
  const papercuts = await tx.doc(Papercuts, ROOT_CONVERSATION_ID)
  const row = papercuts.rows.find((item) => item.id === id)
  if (!row) throw new Error(`No papercut ${String(id)}: the index keeps the newest ${ROWS} rows`)
  if (row.status !== 'open') throw new Error(`Papercut ${row.id} is already ${row.status}`)
  row.status = how
  row.closed = { at: Date.now(), ...(reference ? { ref: reference } : {}) }
  return {
    row: copy(row),
    open: papercuts.rows.filter((item) => item.status === 'open').length,
  }
}

const rowLine = (row: Papercut, now: number) => {
  const stale = row.count === 1 && now - row.at > STALE_MS
  return [
    `- ${row.id} · ${row.kind}`,
    row.count > 1 ? ` · ${row.count}×` : '',
    ` · ${formatAgo(row.at, now)}${stale ? ', never repeated' : ''}`,
    row.where ? ` · ${row.where}` : '',
    `: ${row.what}`,
    row.fix ? ` · fix: ${row.fix}` : '',
  ].join('')
}

/** The open rows as model text, newest first; rows open over 30 days without a repeat are named as candidates. */
export function listText(rows: readonly Papercut[], now = Date.now()) {
  const open = rows.filter((row) => row.status === 'open').toSorted((a, b) => b.id - a.id)
  if (!open.length) return 'No open papercuts.'
  const stale = open.filter((row) => row.count === 1 && now - row.at > STALE_MS).length
  return [
    `${open.length} open, newest first:`,
    ...open.map((row) => rowLine(row, now)),
    ...(stale
      ? [`${stale} open over 30 days without a repeat: the failures pass proposes closing them.`]
      : []),
  ].join('\n')
}

export function raisedText({ row, repeat, dropped }: Raised) {
  return [
    repeat
      ? `Papercut ${row.id} raised again (${row.kind}${row.where ? ` · ${row.where}` : ''}, now ${row.count}×).`
      : `Raised papercut ${row.id} (${row.kind}${row.where ? ` · ${row.where}` : ''}).`,
    dropped ? `The index keeps the newest ${ROWS} rows: dropped the ${dropped} oldest.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function closedText({ row, open }: { row: Papercut; open: number }) {
  return `Papercut ${row.id} closed as ${row.status}${row.closed?.ref ? ` (${row.closed.ref})` : ''}: ${open} open.`
}

export const actions = {
  list: implementAction(ListAction, async (_args, { host }) => {
    const kept = await host.harness().commit(async (tx) => {
      const rows = (await tx.doc(Papercuts, ROOT_CONVERSATION_ID)).rows
      return rows.map(copy)
    }, context)
    return { text: listText(kept), rows: kept }
  }),
}

export default function papercutExtension(host: ExtensionHost) {
  return defineExtension({
    name: 'papercut',
    tools: [
      defineTool({
        name: 'papercut',
        description:
          'A small friction, recorded while it is fresh, so the next dream can find it reliably: a tool that failed or needed a workaround, an instruction that misled you, a harness or environment limitation, a model mistake worth knowing, something slow enough to cost you time. raise {what, kind, where?, fix?} (default); list the open ones; resolve {id, how, ref?} once it is fixed, noise or superseded, ref naming the commit or memory slug for fixed. Repeating the same kind and where counts up on the open row instead of adding one. Nothing records itself here.',
        parameters: obj({
          action: opt(strEnum(['raise', 'list', 'resolve'])),
          what: opt(str()),
          kind: opt(strEnum(KINDS)),
          where: opt(str()),
          fix: opt(str()),
          id: opt(int({ minimum: 1 })),
          how: opt(strEnum(CLOSINGS)),
          ref: opt(str()),
        }),
        // Not replay-safe (the default): an interrupted raise is never rerun, so it counts at most once.
        async execute(args, api, ctx) {
          const action = args.action ?? 'raise'
          const conversation = api.conversationId
          const caller = host.conversations().find((item) => item.id === conversation)
          // The label names the role (`coordinator`, `lander`); a standing or child agent's label is just `agent`, so
          // its `@name` title says which one raised it.
          const by =
            caller?.label && caller.label !== 'agent' ? caller.label : (caller?.title ?? 'agent')
          const text = await api.commit(async (tx) => {
            if (action === 'list')
              return listText((await tx.doc(Papercuts, ROOT_CONVERSATION_ID)).rows)
            if (action === 'resolve') {
              if (args.id === undefined) throw new Error('resolve needs id')
              if (args.how === undefined)
                throw new Error('resolve needs how: fixed, noise or superseded')
              return closedText(await resolve(tx, args.id, args.how, args.ref))
            }
            if (args.what === undefined)
              throw new Error('raise needs what: the friction in one line')
            if (args.kind === undefined) throw new Error(`raise needs kind: ${KINDS.join(', ')}`)
            return raisedText(
              await raise(tx, {
                what: args.what,
                kind: args.kind,
                where: args.where,
                fix: args.fix,
                conversation,
                by,
                cwd: caller?.cwd ?? host.projectRoot,
              }),
            )
          }, ctx)
          return { output: [{ type: 'text', text }] }
        },
      }),
    ],
  })
}
