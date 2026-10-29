import { access, readdir } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { browserBinary } from '../extensions/browser/server.ts'

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  access: vi.fn<typeof access>(),
  readdir: vi.fn<typeof readdir>(),
}))
vi.mock('node:os', () => ({ homedir: () => '/home/test' }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const installed = new Set<string>()

beforeEach(() => {
  installed.clear()
  vi.stubEnv('ULTIMATE_CHROMIUM', undefined)
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  vi.mocked(readdir).mockResolvedValue([])
  vi.mocked(access).mockImplementation(async (path) => {
    if (!installed.has(String(path))) throw new Error('ENOENT')
  })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it.each([
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/home/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/home/test/Applications/Chromium.app/Contents/MacOS/Chromium',
])('finds an installed macOS browser at %s', async (path) => {
  installed.add(path)
  expect(await browserBinary()).toBe(path)
})

it('prefers the explicit browser over installed macOS browsers', async () => {
  vi.stubEnv('ULTIMATE_CHROMIUM', '/custom/chrome')
  installed.add('/custom/chrome')
  installed.add('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  expect(await browserBinary()).toBe('/custom/chrome')
})

it('keeps Linux system and newest cached browser precedence', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  const newest = '/home/test/.cache/ms-playwright/chromium-222/chrome-linux64/chrome'
  vi.mocked(readdir).mockResolvedValue(['chromium-111', 'chromium-222'] as never)
  installed.add('/usr/bin/chromium')
  installed.add('/usr/bin/google-chrome-stable')
  installed.add(newest)
  expect(await browserBinary()).toBe('/usr/bin/chromium')
  installed.delete('/usr/bin/chromium')
  expect(await browserBinary()).toBe('/usr/bin/google-chrome-stable')
  installed.delete('/usr/bin/google-chrome-stable')
  expect(await browserBinary()).toBe(newest)
})

it('explains how to provide a browser when none is installed', async () => {
  await expect(browserBinary()).rejects.toThrow('No Chromium found. Set ULTIMATE_CHROMIUM')
})
