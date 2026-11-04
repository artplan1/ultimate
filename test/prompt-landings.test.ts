import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { git } from '../lib/git.ts'
import { buildNote, landings } from '../extensions/prompt/server.ts'
import { Committed } from '../extensions/coding-tools/refs.ts'
import { SubmissionLanded } from '../extensions/workspaces/refs.ts'
import { temp } from './helpers.ts'
import type { ExtensionHost } from '../server/extensions.ts'

it.each(['public IDs', 'private records'])(
  'names landed branches and their workers using %s',
  async (source) => {
    const cwd = await temp()
    // commit-tree runs no hooks, so Ultimate's own trailer hook (set when this runs from its bash) stays out.
    const commit = async (subject: string, trailer?: number) => {
      await writeFile(join(cwd, 'file'), subject)
      await git(cwd, 'add', '.')
      const tree = await git(cwd, 'write-tree')
      const parent = await git(cwd, 'rev-parse', '--verify', '-q', 'HEAD').catch(
        // The first commit has no parent.
        () => '',
      )
      const sha = await git(
        cwd,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        'commit-tree',
        tree,
        ...(parent ? ['-p', parent] : []),
        '-m',
        trailer ? `${subject}\n\nUltimate-Conversation: ${trailer}` : subject,
      )
      await git(cwd, 'update-ref', 'HEAD', sha)
      return sha
    }
    await git(cwd, 'init', '-q')
    const from = await commit('base')
    const worker = await commit('questions: answer card', source === 'public IDs' ? 50 : undefined)
    const merge = await commit(
      source === 'public IDs' ? 'Merge 1234567 from #40 into main' : 'Merge 1234567 into main',
    )
    await commit('hand edit')
    const to = await commit('skills: chip', 60)
    const conversations = [
      { id: 40, title: 'Answer card redesign', busy: false },
      {
        id: 50,
        title: 'Prototype a card',
        label: 'designer',
        parentConversationId: 40,
        busy: false,
      },
    ]
    const recent = vi.fn<ExtensionHost['eventLog']['recent']>().mockResolvedValue([])
    if (source === 'private records') {
      const commitEvent = {
        id: 300,
        name: Committed.name,
        kind: Committed.kind,
        v: 1,
        at: '2026-01-01T00:00:00Z',
        data: {
          conversation: 90,
          sha: worker,
          rewrittenFrom: 'e'.repeat(40),
          parents: [from],
          repo: await git(cwd, 'rev-parse', '--show-toplevel'),
          branch: 'main',
          subject: 'questions: answer card',
        },
      }
      recent
        .mockResolvedValueOnce(
          Array.from({ length: 200 }, (_, index) => ({
            ...commitEvent,
            id: 500 - index,
            data: { ...commitEvent.data, sha: 'f'.repeat(40) },
          })),
        )
        .mockResolvedValueOnce([
          commitEvent,
          {
            id: 299,
            name: SubmissionLanded.name,
            kind: SubmissionLanded.kind,
            v: 1,
            at: '2026-01-01T00:00:00Z',
            data: {
              submission: 's1',
              conversationId: 40,
              at: 1,
              sha: merge,
              base: worker,
              target: 'main',
              lander: 3,
              divergence: 'None',
              title: 'Answer card redesign',
              commits: [],
              commitCount: 1,
              paths: [],
            },
          },
          {
            ...commitEvent,
            id: 298,
            data: { ...commitEvent.data, conversation: 50, sha: 'e'.repeat(40) },
          },
        ])
    }
    const landed = await landings(cwd, from, to, conversations, {
      recent: recent as ExtensionHost['eventLog']['recent'],
    })
    expect(recent.mock.calls[1]?.[0]?.before).toBe(source === 'private records' ? 301 : undefined)
    expect(landed.map(({ conversation, title }) => ({ conversation, title }))).toEqual([
      { conversation: 60, title: 'skills: chip' },
      { conversation: undefined, title: 'hand edit' },
      { conversation: 40, title: 'Answer card redesign' },
    ])
    const build = { id: 'b2', generation: 3, history: [] } as never
    expect(buildNote(build, 'b1', landed)).toBe(
      `Build changed: b1 → b2 · generation 3 · landed: skills: chip (#60), hand edit (${landed[1].sha.slice(0, 7)}), Answer card redesign (#40)`,
    )
  },
)
