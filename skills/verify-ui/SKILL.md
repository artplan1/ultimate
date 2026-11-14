---
name: verify-ui
description: Check a UI change with screenshots and the browser. Use after changing anything a person sees, before reporting it done.
---

# Look at the change

Never claim a UI change works without an image of it.

## Where to look

- UI changes in the host checkout's `web/` and built-in `extensions/`, and the running host project's
  `.ultimate/extensions/`, hot-reload in the host: a `screenshot` with no `url` reads the host's own UI.
- Changes in another checkout, worktree or project do not reach the shared host: use that checkout's preview URL.
- `server/` or `shared/` changes need a fresh preview before restarting the host.
- Only a screenshot may leave `url` out. `browser` sends its steps to a page, and with no `url` that page is the host's
  UI: the user's own conversation. Name the intended page's URL on every `browser` call, the host's or a preview's.

## How

- `screenshot {url}` for a still image; `selector` for one element, `fullPage` for long pages, `width: 390` for phone,
  `theme: 'light'` and `'dark'` for both themes. Omit `path` so the PNG stays outside your checkout.
- `browser {url, steps}` to drive a state: `click`, `fill` (`#composer-input` is the composer), `press`
  (`Meta+k` opens ⌘K on macOS, `Control+k` elsewhere; `mod` in `web/src/sdk/keys.ts`), `wait`, `eval`. The result
  lists console errors and failed requests: read them.
- Before interacting, `{wait: 'body:not(:has(#resume)) #app'}` waits for the inert startup snapshot to leave, so selectors
  match only the live app.
- `eval` takes one expression and returns its value: `document.title`,
  `[...document.querySelectorAll('[data-entry-id]')].length`. Statements or `await` go in an async IIFE:
  `(async () => { const r = await fetch('/api/x'); return r.status })()`. A bare `const x = …; return x` fails.
- Scope selectors to the card or panel under test: `[data-entry-id="42"] button:has-text("Retry")`, not
  `button:has-text("Retry")`, which clicks the first match anywhere on the page.
- Wait on Ultimate's state, never a guessed time, and give the conversation on every `send` and `until`, so a step
  names the conversation it acts on: `{send: 'prompt', conversation: <id>}` submits without the composer, then
  `{until: 'idle', conversation: <id>}` returns when that turn is done, `{until: 'quiet', conversation: <id>}` when
  nothing runs anywhere (branches and subagents included), and `{until: {entry: 'pi.tool-result'}}` or
  `{until: {event: 'workspaces.landed', where: {…}}}` when that appears, each with its `conversation` as well. A step
  without one takes the conversation the page shows, which on a page loaded without `url` is the user's own. A timeout
  says what was still busy. Click and fill only when the interaction itself is under test; never a fixed `wait <ms>`.
- Set up state (model, thinking, Play/Pause, abort) through the page's SDK in one `eval`, or curl the preview's HTTP
  API, not by clicking menus: `{eval: "window.ultimate.api.configure({model: {provider: 'openai-codex', modelId:
  'gpt-6.1-sol'}}, 2)"}`. Also `api.abort(id)`, `api.compact(undefined, id)`, `api.action({extension: 'pause', name:
  'play'}, null)`; `extensions/browser/README.md` has the rest.
- `where` matches only fields the event carries, and events never carry text: after a send, match
  `{event: 'user.input', where: {conversation: <id>, kind: 'prompt'}}`, not the prompt. Each event's fields are in
  `extensions/browser/README.md` and its `defineEvent`. Tool calls live inside `pi.assistant`; there is no
  `pi.toolCall` entry.
- Open a conversation with `?conversation=<id>`. Right-panel section titles show their source text in sentence case
  (the `section-label` utility); match them with `textContent.startsWith('Skills')`, since counts and meta follow.
- Seed real state with real prompts on a preview; do not inject entries.

## What to check

1. Every state: loading, empty, error, one item, many items, a long title.
2. It matches its neighbours: an existing card or panel next to it, theme tokens, spacing.
3. One control's label and its effect together: click it, then set what the label says happened against what the
   screen now shows. A label naming the next value where the click sets a different one fails that pair, and checking
   either alone misses it.
4. Transcript UI, on a long conversation:
   1. scrollback: scroll up and back down; nothing jumps or reflows;
   2. live streaming: watch a reply and its tool calls stream in;
   3. folding: fold and unfold tool calls and update groups;
   4. phone width: a screenshot at `width: 390`.
5. No new console errors.

Say what you could not reach as unverified, with the reason.
