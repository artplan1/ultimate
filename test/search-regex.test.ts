// fast-test-reason: type-only import; spawn is mocked with in-memory streams, no process is started.
import type { spawn as spawnProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { searchRegex } from '../extensions/search/regex.ts'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn<typeof spawnProcess>() }))
vi.mock('node:child_process', () => ({ spawn }))
afterEach(() => vi.resetAllMocks())

function processStream(code: number | null = null, signal: NodeJS.Signals | null = 'SIGTERM') {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn<() => boolean>(() => {
      child.stdout.end()
      child.stderr.end()
      queueMicrotask(() => child.emit('close', code, signal))
      return true
    }),
  })
  spawn.mockReturnValue(child as never)
  return child
}

function event(type: string, path: string, line?: number) {
  return (
    JSON.stringify({
      type,
      data: {
        path: { text: path },
        ...(line === undefined ? {} : { line_number: line, lines: { text: 'foo\n' } }),
      },
    }) + '\n'
  )
}

it('stops at the extra match when EOF already completed the visible match context', async () => {
  const child = processStream()
  const result = searchRegex({ pattern: 'fo+', context: 2, limit: 1 }, process.cwd())
  child.stdout.write(
    event('begin', 'a.ts') +
      event('match', 'a.ts', 1) +
      event('end', 'a.ts') +
      event('begin', 'b.ts') +
      event('match', 'b.ts', 1),
  )
  // No EOF or remaining context from b.ts: reading it would leave this search hanging.
  expect(await result).toEqual({
    kind: 'content',
    items: [{ path: 'a.ts', line: 1, text: 'foo' }],
    total: 1,
    more: 1,
  })
  expect(child.kill).toHaveBeenCalledOnce()
})

it('retains bounded error diagnostics instead of hiding an rg error after early stopping', async () => {
  const child = processStream(2, null)
  const result = searchRegex({ pattern: 'fo+', context: 0, limit: 1 }, process.cwd())
  child.stderr.write('rg: permission denied\n' + 'x'.repeat(20000))
  child.stdout.write(event('begin', 'a.ts') + event('match', 'a.ts', 1) + event('match', 'a.ts', 2))
  const error = await result.catch((reason: Error) => reason)
  expect(error).toBeInstanceOf(Error)
  const message = (error as Error).message
  expect(message).toContain('rg: permission denied')
  expect(message.length).toBeLessThan(10000)
})
