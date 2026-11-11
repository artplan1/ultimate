/** Papercuts in the browser: the small frictions agents raised, and the document the Documents tab shows. Browser-safe. */
import { actionRef, docRef } from '../../shared/extension-api.ts'

/** What kind of friction it was: a tool, an instruction, the harness, the environment, the model, or something slow. */
export type PapercutKind = 'tool' | 'instruction' | 'harness' | 'environment' | 'model' | 'slow'
/** Why a row was closed: it was fixed, it was noise, or something else replaced it. */
export type Closing = 'fixed' | 'noise' | 'superseded'

/** One recorded friction. A repeat of the same `kind` and `where` counts up instead of adding a row. */
export type Papercut = {
  /** Stable id, increasing; the newest row has the highest. */
  id: number
  /** When it was first raised, epoch ms. */
  at: number
  /** The conversation that raised it. */
  conversation: number
  /** Who raised it: the conversation's label (`coordinator`, `lander`), else a standing or child agent's `@name`. */
  by: string
  /** The working directory it happened in. */
  cwd: string
  kind: PapercutKind
  /** The friction in one line. */
  what: string
  /** Where it happened: a tool name, `path:line`, `#conversation/entry`. */
  where?: string
  /** One line on what would make it cheap. */
  fix?: string
  /** How many times it was raised while open. */
  count: number
  status: 'open' | Closing
  /** When and with what it was closed; `ref` is the commit or memory slug that fixed it. */
  closed?: { at: number; ref?: string }
}

/**
 * `{ next, rows }` on conversation 1: the newest 100 rows, open and closed, oldest first. It lives with the chapter, so
 * the conversation entries that raised the rows stay the durable record across chapters.
 */
export const PapercutDoc = docRef<{ next: number; rows: Papercut[] }>('papercut')

/** No arguments → the open rows as the tool lists them, for the dream's failures pass. Never a search. */
export const ListAction = actionRef<null, { text: string; rows: Papercut[] }>('papercut', 'list')
