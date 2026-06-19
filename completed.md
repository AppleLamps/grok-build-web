# Completed Features

Moved here from `featurestoadd.md` so the active backlog stays focused.

Scoped to **CLI feature parity**: each item maps to an existing `grok`
capability, browser-side parity glue, or a changelog-derived compatibility
check that has been handled.

## Turn Lifecycle

- **[done] Text and multimodal attachments** — `[plumbing]` Attach button
  inserts accepted text/code/markdown files into the composer as fenced code
  blocks. Images and PDFs upload to the session workspace and can be added
  through attach, drag-and-drop, or paste. Unsupported or oversized files show a
  toast.
- **[done] Browser voice input** — `[plumbing]` Mic button uses the browser Web
  Speech API when available and appends final transcripts to the composer
  without auto-sending.
- **[done] Cancel running turn** — `[acp session/cancel]` Stop button in
  composer; `POST /cancel`.
- **[done] Permission prompt UI** — `[acp session/request_permission]` Cards
  with per-option buttons; auto-deny after 5 min if forgotten. Active only when
  the pill is in Manual mode.
- **[done] Always-approve toggle** — `[slash /always-approve]`
  `[flag --always-approve]` Composer pill toggles auto/manual; bridge mirrors
  state and best-effort syncs to the agent.
- **[done] Plan mode rendering** — `[tool enter_plan_mode/exit_plan_mode]` Plan
  content rendered as a distinct blue card with **Accept plan / Suggest edits…
  / Reject** buttons that post a follow-up prompt.
- **[done, guarded] Permission mode field** — `[flag --permission-mode]`
  Settings exposes current CLI permission modes when the installed CLI
  advertises `--permission-mode`; otherwise the field renders disabled with an
  unsupported notice.
- **[done via Settings] Effort / reasoning controls** — `[flag --effort]`
  `[flag --reasoning-effort]` Settings panel exposes
  `low | medium | high | xhigh | max` for both. Respawns on apply.
- **[done via Settings] Max turns limit** — `[flag --max-turns]` Settings panel
  field.
- **[done via Settings] Todo gate** — `[flag --todo-gate]` Settings panel
  checkbox when the installed CLI advertises the flag.

## Sessions

- **[done] Resume on launch** — `[flag -c / --continue]`
  `[flag -r / --resume]` `?session=<sid>` and `?continue=1` URL params honored.
- **[done] Search sessions** — `[cli sessions search]` Sidebar search box
  filters cached projects and recents client-side.
- **[done] Project drawer by cwd** — `[cli sessions list]` Sidebar groups
  sessions by cwd as expandable projects, opens the current project by default,
  and shows the four newest sessions under each project.
- **[done] Mobile project drawer** — Under 760px, the sidebar becomes an
  off-canvas drawer opened from the topbar menu button. Backdrop, `Escape`,
  session links, New session, Sign in, Settings, and Tools actions close it.
- **[done] Change workspace in web UI** — Topbar workspace button starts a new
  per-tab session in the requested cwd and preserves it in `?cwd=`.
- **[done] Share session** — `[cli share <sid>]` Topbar share button calls
  `grok share`; copies URL and toasts.
- **[done] Export trace** — `[cli trace <sid>]` Sidebar Tools -> "Export trace"
  calls `grok trace --local --json`; toasts the resulting path.
- **[done] Import sessions** — `[cli import]` Sidebar Tools -> "Import
  sessions" opens a modal with a textarea for IDs / .jsonl paths; posts to
  `/cli/import`.
- **[done via Settings] Restore-on-resume** — `[flag --restore-code]` Checkbox
  in the Settings panel; when set, `session/load` first respawns the agent with
  `--restore-code`.
- **[done] Sessions cache invalidation** — `[plumbing]` Server watches
  `~/.grok/sessions/` recursively and broadcasts `sessions_changed`; client
  auto-reloads the recents list.

## Models & Auth

- **[done via Settings] Model switcher** — `[cli models]` `[flag --model]`
  Settings panel "Model" field. Sidebar Tools -> "Models" shows available.
- **[done] Footer / composer model picker** — `[cli models]` `[flag --model]`
  Footer model label and composer model tag open a compact picker that respawns
  the agent through the existing settings flow.
- **[done] Login / auth methods** — `[cli login]` `[flag --device-auth]`
  Sidebar "Sign in" button triggers `grok login --device-auth` and shows the
  device URL/code in a modal.

## Slash Commands

- **[done] Slash command autocomplete** — `[slash *]` Dropdown when input starts
  with `/`. Filters by name/description, Tab/Enter to complete, Arrow keys to
  navigate.
- **[done via autocomplete] `/compact`, `/context`, `/session-info`,
  `/feedback`, `/imagine`, `/imagine-video`** — all reachable through the
  autocomplete dropdown. Per-command custom UIs remain polish opportunities, but
  each command works today.

## Memory

- **[done via autocomplete] `/memory`, `/dream`, `/flush`** — All reachable
  through autocomplete.
- **[done via Settings] No-memory / experimental-memory toggle** —
  `[flag --no-memory]` `[flag --experimental-memory]`.
- **[done] Memory search rendering** — `[tool memory_search / memory_get]` Tool
  labels read "Searched memory" / "Read memory".

## Hooks

- **[done] Surface hook execution events** — Rendered as small
  `hook <event> -> <name> Nms` lines in the log.
- **[done] Hooks management UI** — Sidebar Tools -> "Hooks" shows the slash
  commands reachable via autocomplete: `/hooks-list`, `/hooks-trust`,
  `/hooks-untrust`, `/hooks-add`, `/hooks-remove`.

## MCP

- **[done] MCP server panel** — Sidebar Tools -> "MCP servers" calls
  `/cli/mcp` -> `grok mcp list`.
- **[done] MCP tool list** — `_meta.tools` in the initialize response surfaces
  in slash autocomplete.

## Plugins & Skills

- **[done] Plugins UI** — Sidebar Tools -> "Plugins" shows the available slash
  commands: `/plugins list/trust/add/remove`, `/reload-plugins`. They're all
  reachable via autocomplete.
- **[done via autocomplete] Skill picker** — User skills appear in slash
  autocomplete with their descriptions.

## Tools

- **[done] Diff viewer** for `edit` tool calls — Shows `+ new / - old` blocks
  in tool details when `old_string`/`new_string` are present.
- **[done] Terminal output styling** — `[tool run_terminal_command]` ANSI color
  codes are parsed into styled spans.
- **[done] Background tasks / monitors panel** —
  `[tool run_terminal_command]` `[tool monitor]` Dedicated live panel with
  grouped tasks, monitors, loops, status, output, and kill/open actions.
- **[done] Todo board** — `[tool todo_write]` Renders both inline and in a
  sidebar panel that updates live.
- **[done] Browser tool rendering** — `[tool browser_tab /
  browser_network_details / browser_replay / browser_snapshot]` Labels
  recognized with URL/action/page text, screenshots, console errors, cookies,
  DOM/HTML snapshot outlines and source, browser replay timelines, and network
  tables when structured data is present.
- **[done] Web search / fetch rendering** — `[tool web_search / web_fetch]`
  Labels recognized with robust nested result extraction, links, timestamps, and
  snippets when present.
- **[done] X search rendering** — `[tool x_search / x_search_posts /
  twitter_search / search_x]` Labels recognized with query, count, handles,
  timestamps, links, and snippets when present.
- **[done] Multimodal read_file rendering** — `[tool read_file]` Content arrays
  and raw output fields render text, images, videos, PDFs, file cards, and
  extracted PDF/PPTX text.
- **[done] Image / video gen rendering** — `[tool image_gen / video_gen]`
  Inline preview when `rawOutput.url` is present or when the CLI emits local Grok
  session media paths served through `/session-media`.
- **[done] Scheduler / Routines UI** —
  `[tool scheduler_create / scheduler_delete / scheduler_list]` Sidebar Tools ->
  "Routines" opens an agent-driven panel for list/create/delete prompts.
- **[done] Tool call grouping** — When 3+ tool calls happen back-to-back, they
  collapse into a single "N tools" line.
- **[done] Subagent nesting styles** — CSS class `.tool.subagent-child` exists
  for indentation.

## Worktrees

- **[done] Worktree panel** — Sidebar Tools -> "Worktrees" calls
  `/cli/worktree`.
- **[done via Settings] --worktree integration** — Indirectly settable via the
  respawn pipeline.

## Advanced

- **[done] Best-of-N tournaments** — `[flag --best-of-n N]`
  `[skill /best-of-n]` Composer send-mode dropdown runs
  `POST /cli/oneshot {bestOfN:N, text, cwd}` as a headless one-shot.
- **[done] Configurable headless runner** — `[flag -p]`
  `[flag --output-format]` `[flag --session-id]` `[flag --resume]`
  `[flag --continue]` Sidebar Tools -> "Headless" opens a one-shot runner with
  selectable output format and new/named/resume/continue session modes.
- **[done via Settings] Subagents toggle** — `[flag --no-subagents]`.
- **[done via Settings] Agent / subagent definitions** — `[flag --agent]`
  `[flag --agents <JSON>]` Settings panel exposes primary agent selection and
  inline subagent JSON, with server-side JSON validation before respawn.
- **[done] Subagent nested card styling** — `[flag --agents <JSON>]` See
  "Subagent nesting styles".
- **[done] Self-verification (`--check`)** — `[flag --check]` Composer send-mode
  dropdown runs a headless one-shot via `POST /cli/oneshot {check:true, text,
  cwd}`.
- **[done via Settings] Sandbox profiles** — `[flag --sandbox <PROFILE>]`.
- **[done via Settings] Allow / deny rules** — `[flag --allow]` `[flag --deny]`
  Text-area in Settings, one rule per line.
- **[done via Settings] Tool allow-list / deny-list** — `[flag --tools]`
  `[flag --disallowed-tools]`.
- **[done via Settings] System prompt override** —
  `[flag --system-prompt-override]`.
- **[done via Settings] Extra rules** — `[flag --rules]`.
- **[done via Settings] Disable web search** — `[flag --disable-web-search]`.

## Bridge Plumbing

- **[done] SSE reconnect with backoff** — `[plumbing]` Exponential backoff
  capped at 15s; visible disconnected/retry status.
- **[done] Per-tab sessions** — `[plumbing]` Each browser tab has its own
  `sessionId` stored in URL and local storage. The bridge lazy-spawns one
  `grok agent stdio` child per tab session; events are tagged with `sessionId`
  and SSE subscribers filter to one session.
- **[done] Local HTTP hardening** — `[plumbing]` Adds CSP, frame blocking,
  `nosniff`, local Host validation, same-origin checks for mutating browser
  requests, and backpressure-aware SSE replay with listener cleanup.
- **[done] Update notifications** — `[cli update --check]` Yellow banner on page
  load if `grok update --check --json` reports a newer version.
- **[done] Inspect view** — `[cli inspect --json]` Sidebar Tools -> "Inspect
  config" shows the discovered config as JSON.

## Changelog-Derived Completions

- **[DONE] Mermaid code-block rendering / export** — `[plumbing]` Safe Mermaid
  preview for assistant/code-block content with open/export actions.
- **[DONE] Compaction visibility and controls** — `[slash /compact]`
  `[slash /context]` `[flag --compaction-mode]` `[flag --compaction-detail]`
  Settings exposes supported compaction launch flags when advertised, and web
  surfaces compaction result metadata in the transcript plus Tools -> Session
  info when emitted.
- **[DONE] OpenTelemetry/exported usage observability** — `[plumbing]` Web
  documents pass-through OTEL env/config and Tools -> Session info shows whether
  telemetry-related env is active without exposing values.
- **[DONE] `/code-review` command validation** — `[slash /code-review]`
  Streamed slash-command updates normalize `/code-review`, and the compatibility
  fallback includes it for older or partial command streams.
- **[DONE] Agent Dashboard parity audit** — `[cli dashboard]` Web exposes local
  disk-backed sessions in the sidebar with an empty-session toggle for
  idle/zero-message sessions; no separate terminal launch link is needed.
- **[DONE] Manual fold stability for streaming blocks** — `[plumbing]` Tool
  details defer updates while collapsed, grouped tool cards preserve manual
  toggles during streaming, and thinking traces keep manual expansion open when
  the turn completes.
- **[DONE] Calendar date rollover notice** — `[plumbing]` The bridge injects a
  date-rollover system notice into the next user prompt after the local date
  changes and emits `date_rollover_notice` metadata.
- **[DONE] Web-fetch GitHub error guidance** — `[tool web_fetch]`
  GitHub-hosted `web_fetch` failure guidance falls through the generic tool
  detail renderer as raw output, preserving the full `gh` CLI recommendation
  without truncation.
- **[DONE] MCP resilience regression coverage** — `[plumbing]` Added regression
  coverage for undecodable/non-JSON stdio lines and concurrent session-load
  coalescing; live checklist keeps plugin MCP reconnect and bad-stdio checks.
- **[DONE] Windows path cleanliness regression coverage** — `[plumbing]` Added
  regression coverage for model-facing attachment prompt paths, rendered
  attachment labels, and same-session cross-cwd tab resumes.
- **[DONE] Large session replay / fork regression coverage** — `[plumbing]`
  Added bridge coverage for oversized replay history pruning and fork-session
  replay isolation; live checklist keeps real saved-session artifact checks.

## Foundations Shipped

- **Modular client** — JS modules under `public/js/`, including tool renderers.
- **Modular bridge** — thin `server.mjs` entry plus `lib/` modules for ACP,
  HTTP routes, sessions, and CLI shell-outs.
- **CLI shell-out helper** — `createCliRunner()` plus `/cli/*` endpoints.
- **Respawn machinery** — per-agent and global `GrokBridge.respawn(newOpts)` and
  `POST /session/respawn`.
- **Generic modal** — `modal(title, body)` in `modal.js`.
- **Tool dispatch** — `summarizeTool()` and `details-registry.mjs` recognize
  core tool kinds; specialized renderers plug in cleanly.
- **Sessions file watcher** — `watchSessionsRoot()` broadcasts
  `sessions_changed` so the client reloads recents.
- **Regression tests** — `npm test` runs fake ACP, bridge, renderer,
  sidebar/settings, lifecycle, API, bootstrap, slash-command, and session-edge
  tests. `npm run test:live` runs real CLI integration checks with opt-in X
  search and plugin MCP auth checks.
