import { expect, it } from 'vitest'
import { readPs } from '../load.ts'

it('reads ps lines into the heaviest processes, with the executable name alone', () => {
  const ps = [
    '    1   0.0   8032 /sbin/launchd',
    '  429  74.8 122496 /System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer',
    '60455  55.9 361472 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper (Renderer)',
    '24782  51.9   4160 /opt/homebrew/bin/vitest',
    '  812   0.4  20480 /usr/libexec/logd',
    ' 1010   0.1   4096 /usr/sbin/cfprefsd',
    ' 1011   0.1  65536 /usr/sbin/cfprefsd',
    '',
  ].join('\n')
  expect(readPs(ps)).toEqual([
    { pid: 429, cpu: 74.8, memory: 122496 * 1024, executableName: 'WindowServer' },
    {
      pid: 60455,
      cpu: 55.9,
      memory: 361472 * 1024,
      executableName: 'Google Chrome Helper (Renderer)',
    },
    { pid: 24782, cpu: 51.9, memory: 4160 * 1024, executableName: 'vitest' },
    { pid: 812, cpu: 0.4, memory: 20480 * 1024, executableName: 'logd' },
    // Equal CPU: the larger process first.
    { pid: 1011, cpu: 0.1, memory: 65536 * 1024, executableName: 'cfprefsd' },
  ])
})

it('finds no process in output it cannot read', () => {
  expect(readPs('')).toEqual([])
})
