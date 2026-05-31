# Manual Live Grok Verification

Use this checklist when a live Grok account and current CLI tools are available.

Automated live coverage now exists:

- `npm run test:live` runs real CLI checks for token bootstrap, clean page load, SSE `session_ready`, `/sessions`, `/spawn-opts`, `/cli/models`, `/cli/mcp`, real web search, real `read_file` on PNG/JPG/PDF/PPTX fixtures, and cancellation recovery.
- PowerShell: `$env:GROK_WEB_LIVE_X_SEARCH='1'; npm run test:live` additionally requires a real X-search tool update.
- PowerShell: `$env:GROK_WEB_LIVE_PLUGIN_MCP_NAME='<server-name>'; npm run test:live` additionally requires `grok mcp list` to show a specific plugin MCP server without auth errors.
- `GROK_WEB_LIVE_TIMEOUT_MS` and `GROK_WEB_LIVE_READ_TIMEOUT_MS` can raise timeouts for slow accounts or upstream outages.

Keep these visual/account checks manual when needed:

- Start `npm start`, open the token URL, confirm the clean URL loads and SSE reaches `session_ready`.
- Ask for a real web search and inspect the rendered result card.
- Ask for a real X search if enabled for the account and inspect handles, timestamps, links, and snippets.
- Run `read_file` on `.png`, `.jpg`, `.pdf`, and `.pptx` files and inspect multimodal output.
- Start a background command, fetch output, kill it, and confirm status leaves the composer usable.
- Run a subagent task, cancel during execution, and confirm failed/cancelled status renders.
- Open Settings and confirm unsupported launch flags are disabled for the installed CLI.
- Run `grok mcp list` and test a plugin-provided MCP server that requires auth when available.

## Grok 0.2.14 Compatibility Status

Local compatibility work has been completed against `grok 0.2.14 (e0d895dcd) [stable]` on 2026-05-31. The updater reported `currentVersion` and `latestVersion` as `0.2.14` with `updateAvailable:false`.

Automated verification completed:

- `npm run check` passed syntax, Biome lint, and format checks.
- `npm test` passed 126 account-free tests, with 6 live-only checks skipped.
- `npm run test:live` passed bootstrap/SSE/settings/models/MCP, real web search, multimodal `read_file`, and cancellation recovery. X search and plugin MCP checks remained opt-in.
- `npm run test:visual` passed desktop, settings, thinking-trace, and mobile viewport checks.

Public changelog review:

- The xAI Build changelog visible on 2026-05-31 listed `v 0.2.11` as the newest public notes, while the CLI updater installed 0.2.14.
- Web-relevant 0.2.11 items are already covered by slash autocomplete tests, generated media Open links, streamed terminal card updates, Settings/model busy status, and live web/multimodal checks.
- TUI-only items, including terminal resize, terminal video playback, and extension modal keyboard focus, should be checked in the native Grok TUI when doing full CLI acceptance.

## Grok 0.1.217 Historical Compatibility Status

Local compatibility work has been completed against `grok 0.1.217 (332caedb7)`. The automated live suite passed, and follow-up web fixes landed for slash command compatibility, generated media previews, search/X result cards, Worktrees panel environment handling, and renderer escaping.

Keep these checks in the manual pass when validating future Grok CLI updates:

- Confirm `/export` appears in slash autocomplete from `available_commands_update`, completes cleanly, and does not need a custom web route.
- Confirm `/config-agents` appears in slash autocomplete and renders usable modal or agent output in the chat log.
- Run `/session-info` and verify the exposed session agent name is visible in the rendered output.
- Generate an image and a video, then confirm the rendered card shows the preview and any emitted path or URL.
- Trigger native web search and X search, then confirm result cards still show queries, links, timestamps, handles, and snippets.
- Expand a grouped tool block and confirm the first tool call remains visible.
- Produce large or truncated terminal/tool output containing non-ASCII text, then confirm the bridge and renderer do not crash on UTF-8 boundaries.
- Run a task long enough for proactive system reminders, laziness detector output, or todo reminders to appear, then confirm they render as normal updates without breaking turn state.
- On Windows, confirm Ctrl+X still behaves acceptably in the browser composer and does not conflict with text editing expectations.
- On an extra-large monitor, confirm the app shell, sidebar, composer, modals, and tool groups do not stretch or overlap.
- If testing Linux, paste an image into the TUI separately for CLI validation; Grok Build Web still only supports text-file attachments in the browser.
- If testing a repo with an empty git index, verify `grok -w` no longer crashes in the CLI and that the web Worktrees panel still lists worktrees normally.

## Grok 0.1.218 Historical Follow-up Notes

Grok CLI 0.1.218 introduced the following items. Keep them in future manual compatibility passes when relevant:

- Windows Ctrl+X default shortcut help binding.
- Linux image pasting and shortcut keybinding behavior.
- User-specified duration for video generation.
- Temporary screenshot image support on macOS.
- Image byte validation prevents retry loops.
- Compaction prompt improvements match training behavior and rehydrate skills.
- Increased macOS/Linux ulimit handling prevents ENOSPC failures that can brick the CLI.
- Multi-line image links remain non-clickable and no longer break rendering.
- `_x.ai/ask_user_question` renders as a browser elicitation card and replies with `{ outcome: "accepted", answers, partial_answers }` (or `cancelled` / `skip_interview` / `chat_about_this`).
- Loading a saved session with `plan.json` hydrates the web TODO sidebar before the next live tool update.
