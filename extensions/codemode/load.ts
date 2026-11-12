import { loadavg } from 'node:os'
import { basename } from 'node:path'
import { exec } from '../../lib/exec.ts'

/** A process using CPU now: `ps`'s CPU percentage, its resident memory in bytes, and the executable's name. */
export interface HeavyProcess {
  pid: number
  cpu: number
  memory: number
  command: string
}

export interface MachineLoad {
  /** Load average over 1, 5 and 15 minutes of the whole machine, as `uptime` prints it. */
  load: { one: number; five: number; fifteen: number }
  /** The processes with the highest CPU of every process on the machine, heaviest first. */
  processes: HeavyProcess[]
}

/** How many processes the list keeps: enough to see what is starving the machine, few enough to read. */
const HEAVY = 5

/** `ps -Ao pid=,pcpu=,rss=,comm=` */
const PS = ['-Ao', 'pid=,pcpu=,rss=,comm=']

/**
 * `ps` lines read as processes, heaviest first: `cpu` is the percentage `ps` reports (CPU time over its lifetime, not
 * the last second, so a short burst reads lower than `top` shows), `memory` the resident set in bytes. The command is
 * the executable's name alone: a process's arguments can hold secrets.
 */
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
      command: basename(path),
    })
  }
  return processes.toSorted((a, b) => b.cpu - a.cpu || b.memory - a.memory).slice(0, HEAVY)
}

/**
 * The machine's load and heaviest processes, sampled now: the system snapshot refreshes on file changes, which says
 * nothing about a run that is slow right now.
 */
export async function machineLoad(): Promise<MachineLoad> {
  const { stdout } = await exec('ps', PS)
  const [one, five, fifteen] = loadavg()
  return { load: { one, five, fifteen }, processes: readPs(stdout) }
}
