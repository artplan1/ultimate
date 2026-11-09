import { afterEach, expect, it, vi } from 'vitest'
import { fetchAssets, sourceFrames } from '../lib/source-frames.ts'

// `function Crash(){throw new Error("x")}` from /repo/extensions/a/web.tsx line 3, column 9, in one minified line.
const script = 'function Crash(){throw new Error("x")}\n//# sourceMappingURL=web-1.js.map\n'
const map = JSON.stringify({
  version: 3,
  sources: ['/repo/extensions/a/web.tsx'],
  names: [],
  mappings: 'AAEQ',
})
const files: Record<string, string> = {
  'http://host/assets/web-1.js': script,
  'http://host/assets/web-1.js.map': map,
}

it('maps bundled frames to their source files and keeps the rest', async () => {
  const fetched: string[] = []
  const stack = [
    'Error: x',
    '    at Crash (http://host/assets/web-1.js:1:17)',
    '    at Crash (http://host/assets/web-1.js:1:17)',
    '    at Other (http://host/assets/gone.js:2:5)',
    '    at div (<anonymous>)',
  ].join('\n')
  const source = await sourceFrames(stack, async (url) => {
    fetched.push(url)
    return files[url]
  })
  expect(source).toBe(
    [
      'Error: x',
      '    at Crash (/repo/extensions/a/web.tsx:3:9)',
      '    at Crash (/repo/extensions/a/web.tsx:3:9)',
      '    at Other (http://host/assets/gone.js:2:5)',
      '    at div (<anonymous>)',
    ].join('\n'),
  )
  // Each script and its map are read once.
  expect(fetched).toEqual([
    'http://host/assets/web-1.js',
    'http://host/assets/gone.js',
    'http://host/assets/web-1.js.map',
  ])
})

it('leaves a frame as-is when its source map is HTML and still maps the rest', async () => {
  const html = '<!doctype html><html><body>not a map</body></html>'
  const spa = 'page()\n//# sourceMappingURL=spa.js.map\n'
  const stack = [
    'Error: x',
    '    at Crash (http://host/assets/web-1.js:1:17)',
    '    at Page (http://host/assets/spa.js:1:1)',
    '    at Page (http://host/assets/spa.js:1:1)',
  ].join('\n')
  const source = await sourceFrames(stack, async (url) => {
    if (url === 'http://host/assets/web-1.js') return script
    if (url === 'http://host/assets/web-1.js.map') return map
    if (url === 'http://host/assets/spa.js') return spa
    if (url === 'http://host/assets/spa.js.map') return html
    return undefined
  })
  expect(source).toBe(
    [
      'Error: x',
      '    at Crash (/repo/extensions/a/web.tsx:3:9)',
      '    at Page (http://host/assets/spa.js:1:1)',
      '    at Page (http://host/assets/spa.js:1:1)',
    ].join('\n'),
  )
})

afterEach(() => vi.unstubAllGlobals())

it("fetches only its own origin's bundle assets", async () => {
  const requested: string[] = []
  vi.stubGlobal('fetch', async (url: URL | string) => {
    requested.push(String(url))
    return new Response('x')
  })
  const read = fetchAssets('http://host')
  expect(await read('http://127.0.0.1:1/assets/x.js')).toBe('x')
  expect(requested).toEqual(['http://host/assets/x.js'])
  requested.length = 0
  expect(await read('http://host/api/secret.js')).toBeUndefined()
  expect(await read('http://[bad]/assets/x.js')).toBeUndefined()
  expect(requested).toEqual([])
  const text = 'Error\n    at x (http://[bad]/assets/x.js:1:1)'
  expect(await sourceFrames(text, read)).toBe(text)
})
