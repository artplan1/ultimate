import type { ConversationId, Tx } from '@earendil-works/pi-durable'
import { expect, it } from 'vitest'
import {
  closedText,
  listText,
  Papercuts,
  raise,
  raisedText,
  resolve,
  ROWS,
  STALE_MS,
} from '../server.ts'
import type { RaiseInput } from '../server.ts'
import type { Papercut } from '../refs.ts'

/** A transaction over plain documents, keyed by kind and conversation. */
function fakeTx() {
  const docs = new Map<string, object>()
  return {
    docs,
    tx: {
      doc: async (
        { definition: def }: { definition: { kind: string; initial: () => object } },
        id: number,
      ) => {
        const key = `${def.kind}:${id}`
        if (!docs.has(key)) docs.set(key, def.initial())
        return docs.get(key)
      },
    } as unknown as Tx,
  }
}
const rows = async (tx: Tx) => (await tx.doc(Papercuts, 1 as ConversationId)).rows
const input = (patch: Partial<RaiseInput>): RaiseInput => ({
  what: 'pnpm test extensions/x hung until the timeout',
  kind: 'tool',
  conversation: 7,
  by: 'coordinator',
  cwd: '/work/x',
  ...patch,
})

it('raises a row with its derived fields, lists open rows and closes one', async () => {
  const { tx } = fakeTx()
  const first = await raise(
    tx,
    input({ what: '  pnpm test\nhung  ', where: 'bash', fix: 'run that folder suite' }),
  )
  expect(first).toMatchObject({ repeat: false, dropped: 0 })
  expect(first.row).toMatchObject({
    id: 1,
    conversation: 7,
    by: 'coordinator',
    cwd: '/work/x',
    kind: 'tool',
    what: 'pnpm test hung',
    where: 'bash',
    fix: 'run that folder suite',
    count: 1,
    status: 'open',
  })
  expect(first.row.at).toBeTypeOf('number')
  expect(raisedText(first)).toBe('Raised papercut 1 (tool · bash).')

  await raise(tx, input({ what: 'the lint rule contradicted the prompt', kind: 'instruction' }))
  expect(listText(await rows(tx), 0)).toBe(
    [
      '2 open, newest first:',
      '- 2 · instruction · now: the lint rule contradicted the prompt',
      '- 1 · tool · now · bash: pnpm test hung · fix: run that folder suite',
    ].join('\n'),
  )

  const closed = await resolve(tx, 1, 'fixed', 'abc1234')
  expect(closed).toMatchObject({
    open: 1,
    row: { id: 1, status: 'fixed', closed: { ref: 'abc1234' } },
  })
  expect(closedText(closed)).toBe('Papercut 1 closed as fixed (abc1234): 1 open.')
  expect(listText(await rows(tx), 0)).toBe(
    [
      '1 open, newest first:',
      '- 2 · instruction · now: the lint rule contradicted the prompt',
    ].join('\n'),
  )
  await resolve(tx, 2, 'noise')
  expect(listText(await rows(tx), 0)).toBe('No open papercuts.')
})

it('counts a repeat of the same kind and where up instead of adding a row', async () => {
  const { tx } = fakeTx()
  await raise(tx, input({ what: 'max one failing lookup', where: 'Bash' }))
  const again = await raise(tx, input({ what: 'bash: lookup failed again', where: 'bash' }))
  expect(again).toMatchObject({ repeat: true, row: { id: 1, count: 2 } })
  // The row keeps the wording of the raise that opened it; matching ignores case.
  expect(raisedText(again)).toBe('Papercut 1 raised again (tool · Bash, now 2×).')
  // Without a where, the first words stand in for it; another kind is another row.
  await raise(tx, input({ what: 'the tool list rule misled me twice' }))
  const worded = await raise(tx, input({ what: 'the tool list rule misled me' }))
  expect(worded.row).toMatchObject({ id: 2, count: 2 })
  expect(await rows(tx)).toHaveLength(2)
})

it('keeps the newest rows and says what the cap dropped', async () => {
  const { tx } = fakeTx()
  for (let index = 0; index <= ROWS; index++)
    await raise(tx, input({ what: `friction ${index}`, where: `tool-${index}` }))
  const kept = await rows(tx)
  expect(kept).toHaveLength(ROWS)
  expect(kept[0].id).toBe(2)
  expect(kept.at(-1)?.id).toBe(ROWS + 1)
  const raised = await raise(tx, input({ what: 'one more', where: 'tool-more' }))
  expect(raised.dropped).toBe(1)
  expect(raisedText(raised)).toContain(
    `The index keeps the newest ${ROWS} rows: dropped the 1 oldest.`,
  )
  await expect(resolve(tx, 1, 'noise')).rejects.toThrow(`the index keeps the newest ${ROWS} rows`)
})

it('offers rows open over 30 days without a repeat for closing', async () => {
  const { tx } = fakeTx()
  await raise(tx, input({ what: 'stale one', where: 'a' }))
  await raise(tx, input({ what: 'repeated', where: 'b' }))
  await raise(tx, input({ what: 'repeated again', where: 'b' }))
  const now = Date.now()
  for (const row of await rows(tx)) row.at = now - STALE_MS - 1000
  const text = listText(await rows(tx), now)
  // Past a week, `formatAgo` prints a short date instead of a count.
  expect(text).toMatch(/- 1 · tool · .+, never repeated · a: stale one/)
  expect(text).toMatch(/- 2 · tool · 2× · .+ · b: repeated/)
  expect(text).not.toContain('b: repeated, never repeated')
  expect(text).toContain('1 open over 30 days without a repeat')
})

it('refuses an empty what, an unknown kind, a long field and a fixed row without ref', async () => {
  const { tx } = fakeTx()
  await expect(raise(tx, input({ what: '   ' }))).rejects.toThrow('what must say the friction')
  await expect(raise(tx, input({ kind: 'vibes' as Papercut['kind'] }))).rejects.toThrow(
    'kind must be',
  )
  await expect(raise(tx, input({ what: 'x'.repeat(281) }))).rejects.toThrow('at most 280')
  await expect(raise(tx, input({ where: 'y'.repeat(121) }))).rejects.toThrow('at most 120')
  await expect(raise(tx, input({ fix: 'z'.repeat(201) }))).rejects.toThrow('at most 200')
  await raise(tx, input({}))
  await expect(resolve(tx, 1, 'fixed')).rejects.toThrow('needs ref')
  await expect(resolve(tx, 99, 'noise')).rejects.toThrow('No papercut 99')
  await resolve(tx, 1, 'superseded', 'memory:model-families')
  await expect(resolve(tx, 1, 'noise')).rejects.toThrow('already superseded')
})
