# Obsidian review follow-up

This note tracks the Obsidian review feedback supplied for SourceDown and explains the required fixes.

## Repository state checked

The review comments reference these files:

- `src/runtime-store.ts`
- `src/sync-engine.ts`
- `src/settings.ts`

Those files are not present on the current `main` branch of this repository. The current source is a smaller implementation centred around `src/main.ts`. Because of that, the exact line-level code changes from the review cannot be applied until the reviewed source files are pushed to this repository.

## Review items and intended fixes

### Avoid `globalThis`

Review warning:

> Avoid using `globalThis`. Use `window` or `activeWindow` for popout window compatibility.

Affected review locations:

- `src/runtime-store.ts:97`
- `src/runtime-store.ts:165`
- `src/runtime-store.ts:181`
- `src/runtime-store.ts:193`

Required fix:

- Replace browser-window access through `globalThis` with `window` where the main Obsidian window is explicitly intended.
- Use `activeWindow` when working with UI created inside Obsidian popout windows, so DOM objects and timers are resolved against the active window rather than the main window.
- Avoid caching a single global window reference for UI state that may be opened in a popout.

### Remove unnecessary assertion

Review warning:

> This assertion is unnecessary since it does not change the type of the expression.

Affected review location:

- `src/sync-engine.ts:1278-1280`

Required fix:

- Remove the redundant assertion and leave the expression typed naturally.
- If the code was relying on the assertion for readability, replace it with a typed variable or a real runtime guard instead.

### Replace deprecated `display`

Review recommendation:

> `display` is deprecated. Since 1.13.0. Use `getSettingDefinitions` instead.

Affected review locations:

- `src/settings.ts:469`
- `src/settings.ts:502`
- `src/settings.ts:820`
- `src/settings.ts:922`
- `src/settings.ts:1155`
- `src/settings.ts:1173`
- `src/settings.ts:1301`
- `src/settings.ts:1370`
- `src/settings.ts:1391`
- `src/settings.ts:1509`
- `src/settings.ts:1523`
- `src/settings.ts:1573`
- `src/settings.ts:1644`
- `src/settings.ts:1685`
- `src/settings.ts:1801`
- `src/settings.ts:1847`

Required fix:

- Replace deprecated `display` usage with the newer `getSettingDefinitions` API.
- Keep user-facing labels and descriptions unchanged unless the old `display` value was doing formatting that must now live in the setting definition.
- Do not replace `PluginSettingTab.display()` unless that is the exact deprecated symbol reported by TypeScript. In standard Obsidian setting tabs, `display()` is still the render hook for the tab.

### Remove deprecated `setDynamicTooltip`

Review recommendation:

> `setDynamicTooltip` is deprecated. The value is now always shown inline next to the slider.

Affected review locations:

- `src/settings.ts:937`
- `src/settings.ts:1549`
- `src/settings.ts:1659`
- `src/settings.ts:1697`
- `src/settings.ts:1728`

Required fix:

- Remove `.setDynamicTooltip()` calls from slider settings.
- Leave slider values, limits, steps, and `onChange` handlers intact.
- Do not add a replacement tooltip unless there is additional information not already shown inline.

### Replace deprecated `setWarning`

Review recommendation:

> `setWarning` is deprecated. Use `setDestructive` for a destructive button, or `setDestructive().setCta()` for a destructive primary action.

Affected review locations:

- `src/settings.ts:1140`
- `src/settings.ts:1290`
- `src/settings.ts:1562`
- `src/settings.ts:1770`
- `src/settings.ts:1818`

Required fix:

- Replace warning-styled destructive buttons with `.setDestructive()`.
- Use `.setDestructive().setCta()` only when the action should be both destructive and the primary call to action.
- Keep confirmation modals or confirmation text around irreversible actions.

## Why this is not applied directly in this branch

The current repository contents do not contain the affected files or line references. Applying fake changes to unrelated files would make the PR misleading and would not resolve the Obsidian review findings.

To complete the actual code fix, push the reviewed source snapshot containing `src/runtime-store.ts`, `src/sync-engine.ts`, and `src/settings.ts`, then apply the changes above in those files.
