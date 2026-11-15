import { loadavg } from 'node:os'
import { basename } from 'node:path'
import { exec } from '../../lib/exec.ts'

export interface HeavyProcess {
  pid: number
  cpu: number
  memory: number
  executableName: string
}

export interface MachineLoad {
  load: { one: number; five: number; fifteen: number }
  processes: HeavyProcess[]
}

const HEAVY = 5

const PS = ['-Ao', 'pid=,pcpu=,rss=,comm=']

export function readPs(text: string): HeavyProcess[] {
  const processes: HeavyProcess[] = []
  for (const line of text.split('\n')) {
    const found = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (!found) continue
    const [, pid, cpu, rss, path] = found
    processes.push({
      pid: Number(pid),
      cpu: Number(cpu),
      memory: Number(rss) * 1024,
      executableName: basename(path),
    })
  }
  return processes.toSorted((a, b) => b.cpu - a.cpu || b.memory - a.memory).slice(0, HEAVY)
}

export async function machineLoad(): Promise<MachineLoad> {
  const { stdout } = await exec('ps', PS)
  const [one, five, fifteen] = loadavg()
  return { load: { one, five, fifteen }, processes: readPs(stdout) }
}
