import { ChevronDownIcon, FolderGit2Icon } from 'lucide-react'
import { useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, useConversations } from '@/sdk'
import { Address } from '../messages/ui.tsx'

/**
 * Whose checkout Review reads: a button naming the conversation, opening the recent conversations. A conversation's
 * worktree, the repository it branched from, or the folder it works in decides what the specs are read from, so a
 * project root that is no repository of its own reviews the subfolder repository its conversations work in.
 */
export function Checkout({ value, onChange }: { value?: number; onChange: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const conversations = useConversations()
  const needle = query.trim().toLowerCase()
  const matches = (id: number, ...texts: (string | undefined)[]) =>
    !needle || [`#${id}`, ...texts].some((text) => text?.toLowerCase().includes(needle))
  const recent = conversations
    .filter((conversation) => !conversation.parentConversationId)
    .toSorted((a, b) => (b.inputAt ?? b.id) - (a.inputAt ?? a.id))
    .filter((conversation) => matches(conversation.id, conversation.title, conversation.label))
    .slice(0, 30)
  const choose = (id: number) => {
    setOpen(false)
    setQuery('')
    onChange(id)
  }
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className="flex h-7 max-w-56 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-border/70 px-2 text-[11.5px] text-muted-foreground hover:bg-accent/60"
          data-review-checkout={value}
          title="The conversation whose checkout Review reads"
          type="button"
        >
          <FolderGit2Icon className="size-3 shrink-0" />
          <span className="flex min-w-0 truncate text-[12px] text-foreground/90">
            {value === undefined ? '…' : <Address id={value} />}
          </span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            className="text-[12.5px]"
            onValueChange={setQuery}
            placeholder="Read another conversation's checkout…"
            value={query}
          />
          <CommandList className="max-h-[60vh]">
            {recent.length === 0 && (
              <CommandEmpty className="py-6 text-center text-[12px] text-muted-foreground">
                Nothing found.
              </CommandEmpty>
            )}
            {recent.length > 0 && (
              <CommandGroup heading="Conversations">
                {recent.map((conversation) => (
                  <CommandItem
                    className={cn(
                      'gap-2 py-1 text-[12.5px]',
                      conversation.id === value && 'text-brand',
                    )}
                    key={conversation.id}
                    onSelect={() => choose(conversation.id)}
                    value={String(conversation.id)}
                  >
                    <Address id={conversation.id} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
