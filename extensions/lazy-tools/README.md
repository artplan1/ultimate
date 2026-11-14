Load optional `automation`, `plan` and `browser` tools on demand without changing their schemas or execution.

`load_tools {names: ['browser']}` offers the requested tools from the next model call. Its description lists configured candidates, not permissions: every requested tool must already be enabled for the conversation, or the whole request fails without loading anything. Already offered tools are a no-op. Only the model can call the loader, not codemode scripts.

## Settings

`lazyTools` in `~/.ultimate/settings.json` sets the machine default. A trusted project's `.ultimate/settings.json` replaces that list, not merges it:

```json
{ "lazyTools": ["automation", "plan", "browser"] }
```

These three are the default when neither layer has the key, and the only supported names. Duplicates and ordering do not change the policy. `[]` restores eager tools and omits the loader. Missing or disabled candidates are not enabled by this setting. Invalid values report an extension load error; a failed reload keeps the last successfully installed facet. After an initial load failure, correct the setting and explicitly disable then enable the extension in its effective settings scope: merely correcting the value may not reload a facet that never installed. No automatic settings repair or fallback policy is added.

The extension wraps configured tools with Pi's `deferred` metadata. Disabling it removes the wraps. The selected provider of `browser` is preserved, including a user extension overriding the built-in tool. Explicit agent tool lists still preload named deferred tools through `definitionAgent`, so @ultimate keeps `automation` upfront, including after a definition refresh. Schedules and browser session cleanup run independently of schema visibility. Other tool schemas and role allowlists are unchanged. Visual verification guidance remains visible before loading enabled browser capabilities.

Loading uses Pi Durable's `control.addTools`: names are stored in `pi.agent.modelTools`, survive storage reopen and compaction, and follow forks as of their fork point. Reconfiguring from an agent definition replaces that selection as usual. Changing the list applies live; eager conversations may need an explicit load on their next request. Historical prompt prefixes are not removed. First use takes an extra model/tool round; after loading a tool its schema saving disappears, while loader overhead remains.

Results use the existing generic tool card: a compact `load_tools` header with requested names, expandable arguments and a short availability result; failures use the same card. No custom renderer, schema registry or execution gateway is added.
