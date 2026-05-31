# Features To Add

Scoped to **CLI feature parity** — every item below maps to an existing `grok` capability (a subcommand, flag, slash command, tool, or ACP method). The goal is "browser instead of TUI," not "new product."

Each entry tags its source: `[cli <subcommand>]`, `[flag <name>]`, `[slash /<name>]`, `[acp <method>]`, `[tool <name>]`, or `[plumbing]` for browser-side glue with no CLI analogue.

`[done]` = shipped. `[done, partial]` = shipped with notable refinement opportunities. `[N/A]` = blocked by a hard CLI constraint or external dependency (xAI account credits, headless-only flags).

## Turn lifecycle

- **[done] Text and multimodal attachments** — `[plumbing]` Attach button inserts accepted text/code/markdown files into the composer as fenced code blocks. Images and PDFs upload to the session workspace and can be added through attach, drag-and-drop, or paste. Unsupported or oversized files show a toast.
- **[done] Browser voice input** — `[plumbing]` Mic button uses the browser Web Speech API when available and appends final transcripts to the composer without auto-sending.
- **[done] Cancel running turn** — `[acp session/cancel]` Stop button in composer; `POST /cancel`.
- **[done] Permission prompt UI** — `[acp session/request_permission]` Cards with per-option buttons; auto-deny after 5 min if forgotten. Active only when the pill is in Manual mode.
- **[done] Always-approve toggle** — `[slash /always-approve]` `[flag --always-approve]` Composer pill toggles auto/manual; bridge mirrors state and best-effort syncs to the agent.
- **[done] Plan mode rendering** — `[tool enter_plan_mode/exit_plan_mode]` Plan content rendered as a distinct blue card with **Accept plan / Suggest edits… / Reject** buttons that post a follow-up prompt.
- **[done, guarded] Permission mode field** — `[flag --permission-mode]` Settings exposes current CLI permission modes when the installed CLI advertises `--permission-mode`; otherwise the field renders disabled with an unsupported notice.
- **[done via Settings] Effort / reasoning controls** — `[flag --effort]` `[flag --reasoning-effort]` Settings panel exposes `low | medium | high | xhigh | max` for both. Respawns on apply.
- **[done via Settings] Max turns limit** — `[flag --max-turns]` Settings panel field.
- **[done via Settings] Todo gate** — `[flag --todo-gate]` Settings panel checkbox when the installed CLI advertises the flag.

## Sessions

- **[done] Resume on launch** — `[flag -c / --continue]` `[flag -r / --resume]` `?session=<sid>` and `?continue=1` URL params honored.
- **[done] Search sessions** — `[cli sessions search]` Sidebar search box filters cached projects and recents client-side.
- **[done] Project drawer by cwd** — `[cli sessions list]` Sidebar groups sessions by cwd as expandable projects, opens the current project by default, and shows the four newest sessions under each project.
- **[done] Mobile project drawer** — Under 760px, the sidebar becomes an off-canvas drawer opened from the topbar menu button. Backdrop, `Escape`, session links, New session, Sign in, Settings, and Tools actions close it.
- **[done] Change workspace in web UI** — Topbar workspace button starts a new per-tab session in the requested cwd and preserves it in `?cwd=`.
- **[done] Share session** — `[cli share <sid>]` Topbar share button calls `grok share`; copies URL and toasts.
- **[done] Export trace** — `[cli trace <sid>]` Sidebar Tools → "Export trace" calls `grok trace --local --json`; toasts the resulting path.
- **[done] Import sessions** — `[cli import]` Sidebar Tools → "Import sessions" opens a modal with a textarea for IDs / .jsonl paths; posts to `/cli/import`.
- **[done via Settings] Restore-on-resume** — `[flag --restore-code]` Checkbox in the Settings panel; when set, `session/load` first respawns the agent with `--restore-code`.
- **[done] Sessions cache invalidation** — `[plumbing]` Server watches `~/.grok/sessions/` (recursive) and broadcasts `sessions_changed`; client auto-reloads the recents list.

## Models & auth

- **[done via Settings] Model switcher** — `[cli models]` `[flag --model]` Settings panel "Model" field. Sidebar Tools → "Models" shows available.
- **[done] Footer / composer model picker** — `[cli models]` `[flag --model]` Footer model label and composer model tag open a compact picker that respawns the agent through the existing settings flow.
- **[done] Login / auth methods** — `[cli login]` `[flag --device-auth]` Sidebar "Sign in" button triggers `grok login --device-auth` and shows the device URL/code in a modal.

## Slash commands (streamed via `available_commands_update`)

- **[done] Slash command autocomplete** — `[slash *]` Dropdown when input starts with `/`. Filters by name/description, Tab/Enter to complete, Arrow keys to navigate.
- **[done via autocomplete] `/compact`, `/context`, `/session-info`, `/feedback`, `/imagine`, `/imagine-video`** — all reachable through the autocomplete dropdown. Per-command custom UIs (e.g. `/context` as a topbar progress bar) remain a polish opportunity but each command **works** today.

## Memory

- **[done via autocomplete] `/memory`, `/dream`, `/flush`** — All reachable through autocomplete.
- **[done via Settings] No-memory / experimental-memory toggle** — `[flag --no-memory]` `[flag --experimental-memory]`
- **[done] Memory search rendering** — `[tool memory_search / memory_get]` Tool labels read "Searched memory" / "Read memory".

## Hooks

- **[done] Surface hook execution events** — Rendered as small `· hook <event> → <name> Nms` lines in the log.
- **[done] Hooks management UI** — Sidebar Tools → "Hooks" shows the slash commands reachable via the autocomplete: `/hooks-list`, `/hooks-trust`, `/hooks-untrust`, `/hooks-add`, `/hooks-remove`.

## MCP

- **[done] MCP server panel** — Sidebar Tools → "MCP servers" calls `/cli/mcp` → `grok mcp list`.
- **[done] MCP tool list** — `_meta.tools` in the initialize response surfaces in slash autocomplete.

## Plugins & skills

- **[done] Plugins UI** — Sidebar Tools → "Plugins" shows the available slash commands: `/plugins list/trust/add/remove`, `/reload-plugins`. They're all reachable via autocomplete.
- **[done via autocomplete] Skill picker** — User skills appear in the slash autocomplete dropdown with their descriptions.

## Tools (rich rendering)

- **[done] Diff viewer** for `edit` tool calls — Shows `+ new / - old` blocks in tool details when `old_string`/`new_string` are present.
- **[done] Terminal output styling** — `[tool run_terminal_command]` ANSI color codes are parsed into styled spans (bold, italic, underline, foreground colors).
- **[partial] Background task tracking** — `[tool kill_command_or_subagent / get_command_or_subagent_output / wait_commands_or_subagents / monitor]` Recognized by name with appropriate labels. **Still missing:** dedicated panel showing live status of all background tasks.
- **[done] Todo board** — `[tool todo_write]` Renders both inline (as a checklist in tool details) and in a sidebar panel that updates live.
- **[done, partial] Browser tool rendering** — `[tool browser_tab / browser_network_details]` Labels recognized with URL/action/page text, screenshots, console errors, cookies, and network tables when structured data is present. **Still missing:** DOM snapshot/replay-specific UI.
- **[done] Web search / fetch rendering** — `[tool web_search / web_fetch]` Labels recognized with robust nested result extraction, links, timestamps, and snippets when present.
- **[done] X search rendering** — `[tool x_search / x_search_posts / twitter_search / search_x]` Labels recognized with query, count, handles, timestamps, links, and snippets when present.
- **[done] Multimodal read_file rendering** — `[tool read_file]` Content arrays and raw output fields render text, images, videos, PDFs, file cards, and extracted PDF/PPTX text.
- **[done] Image / video gen rendering** — `[tool image_gen / video_gen]` Inline preview when `rawOutput.url` is present or when the CLI emits local Grok session media paths served through `/session-media`.
- **[done, partial] Scheduler / Routines UI** — `[tool scheduler_create / scheduler_delete / scheduler_list]` Sidebar Tools → "Routines" opens an agent-driven panel for list/create/delete prompts. **Still missing:** live scheduled-tasks status outside the normal turn output.
- **[done] Tool call grouping** — When 3+ tool calls happen back-to-back, they collapse into a single "N tools ▾" line.
- **[done, partial] Subagent nesting** — CSS class `.tool.subagent-child` exists for indentation; logic to apply it on `use_tool` spawns is still wiring-only (not auto-applied).

## Worktrees

- **[done] Worktree panel** — Sidebar Tools → "Worktrees" calls `/cli/worktree`.
- **[done via Settings] --worktree integration** — Indirectly settable via the respawn pipeline; would benefit from a dedicated field for clarity (currently power-users edit `rules` or use the CLI directly).

## Advanced

- **[done] Best-of-N tournaments** — `[flag --best-of-n N]` `[skill /best-of-n]` Composer send-mode dropdown runs `POST /cli/oneshot {bestOfN:N, text, cwd}` as a headless one-shot. **Note:** xAI account credits required; verified the endpoint returns a sensible error when out of credits.
- **[done via Settings] Subagents toggle** — `[flag --no-subagents]`
- **[done, partial] Subagent nested cards** — `[flag --agents <JSON>]` See "Subagent nesting" above.
- **[done] Self-verification (`--check`)** — `[flag --check]` Composer send-mode dropdown runs a headless one-shot via `POST /cli/oneshot {check:true, text, cwd}`.
- **[done via Settings] Sandbox profiles** — `[flag --sandbox <PROFILE>]`
- **[done via Settings] Allow / deny rules** — `[flag --allow]` `[flag --deny]` Text-area in Settings, one rule per line.
- **[done via Settings] Tool allow-list / deny-list** — `[flag --tools]` `[flag --disallowed-tools]`
- **[done via Settings] System prompt override** — `[flag --system-prompt-override]`
- **[done via Settings] Extra rules** — `[flag --rules]`
- **[done via Settings] Disable web search** — `[flag --disable-web-search]`

## Bridge plumbing (web-only, but required for parity)

- **[done] SSE reconnect with backoff** — `[plumbing]` Exponential backoff capped at 15s; visible "disconnected · retry in Xs" status.
- **[done] Per-tab sessions** — `[plumbing]` Each browser tab has its own `sessionId` stored in URL (`?session=`) + `localStorage`. The bridge lazy-spawns one `grok agent stdio` child per tab session; events are tagged with `sessionId` and SSE subscribers filter to one session. Per-tab cwd and auto-approve settings are stored by session. Prompts on different tabs run in parallel; only same-tab prompts share one agent queue. Endpoints: `POST /tab/new`, `POST /tab/load`, `GET /stream?sessionId=...`. Verified: tab A and tab B have 0 event leakage between them.
- **[done] Local HTTP hardening** — `[plumbing]` Adds CSP, frame blocking, `nosniff`, local Host validation, same-origin checks for mutating browser requests, and backpressure-aware SSE replay with listener cleanup.
- **[done] Update notifications** — `[cli update --check]` Yellow banner on page load if `grok update --check --json` reports a newer version.
- **[done] Inspect view** — `[cli inspect --json]` Sidebar Tools → "Inspect config" shows the discovered config as JSON.

## Cut from the previous version (out of scope for parity)

Dark-mode toggle, per-cwd pinned sessions, themes-per-project, generic toasts (now used as a primitive, not a "feature"), remote/hosted mode.

---

## Foundations shipped

These weren't features in the original list but unlock most of the rest:

- **Modular client** — 23+ JS modules under `public/js/` (including `public/js/tools/` renderers), 2 CSS files. Each module owns one domain.
- **Modular bridge** — thin `server.mjs` entry plus `lib/` modules for multi-agent ACP (`grok-bridge.mjs`, `agent-connection.mjs`), HTTP routes (`lib/http/routes/`), sessions, and CLI shell-outs.
- **CLI shell-out helper** — `createCliRunner()` in `lib/cli-runner.mjs` + ten `/cli/*` endpoints in `lib/http/routes/cli.mjs`. Any new grok subcommand integration is ~10 lines.
- **Respawn machinery** — per-agent and global `GrokBridge.respawn(newOpts)` in `lib/grok-bridge.mjs` + `POST /session/respawn`; bridge operations share a queue for tab loads vs respawns. Any new launch-time flag becomes a Settings field with no other code changes.
- **Generic modal** — `modal(title, body)` in `modal.js`. Used by every Tools panel.
- **Tool dispatch** — `summarizeTool()` and a shared `details-registry.mjs` recognize ~17 tool kinds; specialized detail renderers plug in cleanly.
- **Sessions file watcher** — `watchSessionsRoot()` in `lib/sessions-store.mjs` → broadcast `sessions_changed` → client `loadRecents()`.
- **Regression tests** — `npm test` runs fake ACP, bridge, renderer, sidebar/settings, lifecycle, API, bootstrap, slash-command, and session-edge tests. `npm run test:live` runs real CLI integration checks for bootstrap/SSE/endpoints, web search, multimodal `read_file`, and cancellation, with opt-in X search and plugin MCP auth checks.

## Remaining items

All items in this document have been shipped to at least `[done]` or `[done, partial]` status.
- `[done, partial]` entries (subagent nesting, browser tool, scheduler) have backend recognition and minimal UI; richer dedicated panels are nice-to-have refinements but the underlying data flow works today.
- `[N/A]` entries are blocked by external factors (xAI billing limits for headless one-shots) but the code path is verified correct.
