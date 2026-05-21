# grok-web

A local browser chat UI for the [`grok`](https://x.ai) CLI. Built for people who'd rather drive Grok Build from a chat interface than the TUI.

```powershell
grok --web
```

Spawns the agent, opens your default browser, lets you chat. Same agent, different skin.

## How it works

```
browser  ──POST /prompt──▶  server.mjs  ──stdin──▶  grok agent stdio
browser  ◀──SSE /stream──   server.mjs  ◀──stdout── grok agent stdio
```

The `grok` CLI exposes [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) over `grok agent stdio` — the same JSON-RPC protocol Zed, Claude Code, and Codex use. `server.mjs` spawns it as a child process and bridges it to the browser via plain HTTP + Server-Sent Events. No frameworks, no npm dependencies, no build step.

Multiple browser tabs are supported: each tab keeps its own ACP `sessionId` in the URL (`?session=`) and `localStorage`, and the bridge tags every event with its `sessionId` so SSE subscribers filter to one session. Tabs can also carry an explicit workspace path in `?cwd=`, which lets the web UI switch projects without relaunching `grok-web`.

## Requirements

- Node 24+ (for native `WebSocket` / modern stdlib)
- `grok` CLI installed and authenticated (`grok login`)
- Windows / macOS / Linux

## Files

```
grok-web/
├── server.mjs                # Node bridge: HTTP server + ACP client + CLI shell-out
├── public/
│   ├── index.html            # Just the page shell
│   ├── styles/
│   │   ├── main.css          # Palette, layout, sidebar/mobile drawer, composer, chat
│   │   └── cards.css         # Tool / plan / permission cards (active design area)
│   └── js/                   # 23 ES modules — each owns one domain
│       ├── main.js           # Entry: bootstraps tab session, wires subsystems
│       ├── state.js          # Shared state, DOM refs, TAB_SESSION_ID
│       ├── api.js            # All fetch() wrappers
│       ├── markdown.js       # Markdown renderer + escapeHTML
│       ├── chat.js           # Turns, user/assistant messages, thinking, hooks, errors
│       ├── tools.js          # Tool disclosures: terminal/ANSI, diff, todos, image,
│       │                     #   browser, scheduler, plan card, grouping, subagent nesting
│       ├── permissions.js    # Permission request cards
│       ├── elicitation.js    # Elicitation request cards
│       ├── attachments.js    # Text-file attachment insertion
│       ├── voice.js          # Browser Web Speech input
│       ├── modelpicker.js    # Compact footer/composer model picker
│       ├── routines.js       # Agent-driven scheduler routines panel
│       ├── sidebar.js        # Project drawer, mobile drawer wiring, new-session
│       ├── composer.js       # Input, send/stop, mode pill, send-mode dropdown
│       ├── dispatch.js       # SSE event router
│       ├── sse.js            # EventSource + exponential-backoff reconnect
│       ├── slashcommands.js  # Slash-command autocomplete dropdown
│       ├── toast.js          # Tiny toast helper
│       ├── topbar.js         # Workspace picker, share button, update-available banner
│       ├── settings.js       # Settings panel (launch-flag fields) → respawn
│       ├── modal.js          # Generic modal helper
│       ├── panels.js         # Inspect / MCP / Worktree / Models read-only panels
│       └── tools-menu.js     # Sidebar Tools section + Sign-in + Import
├── package.json              # type:module, no dependencies
└── probe/                    # Protocol-discovery scripts (kept for reference)
```

The `probe/` scripts are optional protocol diagnostics. They default to `GROK_BIN=grok`; the WebSocket probe also requires `GROK_PROBE_URL` because the server key is launch-specific and should not be committed.

**Adding a feature?** Most additions touch one file:
- New tool kind rendering → `tools.js` (extend `summarizeTool` + maybe a specialized renderer)
- New event type → `dispatch.js` + the relevant renderer
- New permission UI → `permissions.js`
- New elicitation UI → `elicitation.js`
- New composer attachment behavior → `attachments.js`
- New voice input behavior → `voice.js`
- New scheduler/routines UI → `routines.js`
- New launch flag → add a field in `settings.js` + arg in `server.mjs` `buildArgv()`
- New CLI subcommand exposure → server route via `runGrokCli()` + wrapper in `api.js`
- Style tweaks → usually `cards.css`

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | The HTML UI. Token-gated. |
| `/static/*` | GET | CSS / JS modules. Unauthenticated (no secrets in static assets). |
| `/stream` | GET | SSE stream of agent events. `?sessionId=` filters to one tab. |
| `/prompt` | POST | `{text, sessionId}` — sends an ACP `session/prompt`. |
| `/cancel` | POST | `{sessionId}` — aborts the running turn for that session. |
| `/permission` | POST | `{rpcId, optionId}` — responds to a pending `session/request_permission`. |
| `/elicitation` | POST | `{rpcId, action, content}` — responds to a pending `elicitation/create`. |
| `/settings` | GET/POST | Read/update bridge settings (currently `{autoApprove}`). |
| `/spawn-opts` | GET | Read current launch-time grok flags. |
| `/session/respawn` | POST | Kill + restart the grok child with new launch flags. |
| `/sessions` | GET | Recent sessions from `~/.grok/sessions/`, sorted by mtime. |
| `/session/new` | POST | `{cwd?}` — legacy single-default-session path; changes the bridge default. |
| `/session/load` | POST | `{sessionId, cwd, restoreCode}` — legacy single-default-session resume path. |
| `/tab/new` | POST | `{cwd?}` — browser UI path: creates an isolated ACP session for the current tab. |
| `/tab/load` | POST | `{sessionId, cwd}` — browser UI path: loads an existing session for the current tab. |
| `/cli/inspect` | GET | `grok inspect --json` |
| `/cli/update-check` | GET | `grok update --check --json` |
| `/cli/models` | GET | `grok models` |
| `/cli/mcp` | GET | `grok mcp list` |
| `/cli/worktree` | GET | `grok worktree list` |
| `/cli/share` | POST | `grok share <current sid>` — returns the share URL. |
| `/cli/trace` | POST | `{sessionId}` — `grok trace --local --json`. |
| `/cli/login` | POST | `grok login --device-auth` — surfaces the device URL/code. |
| `/cli/import` | POST | `{targets:[]}` — `grok import --json -- <targets>`. |
| `/cli/oneshot` | POST | `{text, check, bestOfN, cwd?}` — headless one-shot via `grok -p`. Used for `--check` and `--best-of-n` which aren't available through the interactive stdio. |

The printed launch URL includes a one-time `?token=<token>` bootstrap. The first valid browser request sets an HttpOnly `grok_web` session cookie, redirects to the same URL without `token`, and all API / SSE requests authenticate by cookie after that. `/static/*` is public because the static modules contain no secrets.

## Configuration

Environment variables read at startup:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `0` (random free port) | HTTP port |
| `GROK_BIN` | `grok` | Path to grok binary |
| `GROK_CWD` | `process.cwd()` | Working directory passed to `session/new` |
| `GROK_WEB_NO_OPEN` | unset | Set to skip auto-opening the browser |
| `GROK_WEB_USE_API_KEY` | unset | Set to `1` to keep `XAI_API_KEY` in the agent's env. By default grok-web strips it so the agent uses your grok.com subscription token from `~/.grok/auth.json`. |
| `GROK_WEB_RPC_TIMEOUT_MS` | `120000` | JSON-RPC timeout for non-prompt ACP calls. |
| `GROK_WEB_PROMPT_TIMEOUT_MS` | `1800000` | JSON-RPC timeout for `session/prompt`; timed-out prompts are cancelled. |

The PowerShell wrapper at `~/Documents/PowerShell/Microsoft.PowerShell_profile.ps1` passes the launching directory as `GROK_CWD` so the agent runs where you invoked the command.

Most other knobs (effort, sandbox, allow/deny rules, model, etc.) are set through the **Settings panel** in the browser, which serializes respawns and restarts the agent child with the new flags.

The footer model label and composer model tag open a compact model picker. It uses `grok models` plus known fallback IDs, then applies the selected model through the same respawn path as the Settings panel.

## Workspaces and sessions

The left sidebar is a project drawer. Sessions are grouped by workspace (`cwd`), the current project opens automatically, and each expanded project shows only its four newest sessions while the badge keeps the total session count. The search box filters projects and matching sessions from the cached recents list.

Use the topbar folder button to change workspace. It opens a modal for a filesystem path, creates a new per-tab ACP session with that `cwd`, and reloads the tab with both `?session=` and `?cwd=` so refreshes keep the same workspace. The "New session" button starts another session in the current workspace.

On narrow screens the sidebar becomes an off-canvas project drawer. The topbar menu button opens it, the backdrop or `Escape` closes it, and selecting a session, New session, Sign in, Settings, or a Tools item closes the drawer before navigation.

## Composer extras

The Attach button inserts text-like files into the prompt as fenced code blocks at the cursor. Supported extensions are `.txt`, `.md`, `.js`, `.mjs`, `.ts`, `.tsx`, `.json`, `.css`, `.html`, `.py`, `.sh`, `.ps1`, `.yml`, `.yaml`, `.toml`, `.csv`, `.xml`, and `.log`. Each attach action is capped at 5 files, and each file is capped at 256 KB. Images, PDFs, audio, video, binaries, and oversized files show a toast and are not inserted.

The Mic button uses the browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) when available. Final transcripts are appended to the composer and are never auto-sent. Browsers without Web Speech support disable the button or show an unsupported toast.

## Routines

Sidebar Tools → "Routines" opens an agent-driven scheduler panel. List, create, and delete actions send normal prompts to the active ACP session asking Grok to call `scheduler_list`, `scheduler_create`, or `scheduler_delete`. Results render through the usual turn lifecycle and scheduler tool renderer.

## Protocol notes

ACP methods used:
- `initialize` (`protocolVersion: 1`, client fs + elicitation capabilities)
- `session/new` (`cwd`, `mcpServers: []`)
- `session/load` (`sessionId`, `cwd`, `mcpServers: []`)
- `session/prompt` (`sessionId`, `prompt: [{type:"text",text}]`)
- `session/cancel` (notification)
- `fs/read_text_file` / `fs/write_text_file` (agent-to-client requests, confined to the session cwd)
- `elicitation/create` (agent-to-client request, rendered as a form or URL confirmation card)

Agent `session/update` notifications handled by the UI:
- `agent_thought_chunk` — streamed reasoning, rendered as faint italic gutter text
- `agent_message_chunk` — streamed assistant text, rendered with inline markdown
- `tool_call` / `tool_call_update` — rendered as inline disclosure lines, with specialized renderers for execute/edit/image/todo/browser/scheduler
- `user_message_chunk` — turn boundary marker (mainly during replay of loaded sessions)
- `available_commands_update` — feeds the slash-command autocomplete
- `hook_execution` — small inline line "· hook <event> → <name> Nms"

The agent sends `session/request_permission` requests when a tool wants approval. When the composer pill is in **Manual approval** mode the bridge parks the request and renders a card with per-option buttons; in **Auto-approve** mode the bridge prefers an allow / accept / approve option, otherwise the first non-deny option, and best-effort sends `/always-approve on` to the active tab session to keep state in sync.

The bridge answers every agent-to-client JSON-RPC request with an `id`. Known requests are handled directly (`session/request_permission`, fs, elicitation). Unknown request methods are logged once and answered with `{}` so `session/prompt` can finish and the browser receives `turn_complete`.

Headless composer modes (`+ self-check`, Best of 3, Best of 5) run through `/cli/oneshot`, so they do not append to the interactive ACP session history. The client still sends the active tab `cwd` so the one-shot runs in the selected workspace. Ignored ACP extension `meta` events are available to diagnostics through the `grok-web:meta` browser event, and setting `localStorage.grokweb.debugMeta = '1'` logs them to DevTools.

## See also

- [knownissues.md](./knownissues.md)
- [featurestoadd.md](./featurestoadd.md)
