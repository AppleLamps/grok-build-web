# Grok Build Web

Professional local web workspace for the `grok` CLI and Grok Build workflows.

[Website](https://grokbuildweb.com/) | [xAI](https://x.ai) | [Agent Client Protocol](https://agentclientprotocol.com/)

This project is funded by [Bags](https://bags.fm/8F2FvujRh6zqoR4wtasocKgw4oPcu3MWK4MG77NwBAGS).

Grok Build Web runs on your machine and turns `grok agent stdio` into a browser-based workspace for coding sessions, tool calls, traces, project navigation, settings, routines, uploads, memory, and session management. It is plain Node.js, static HTML, CSS, and browser JavaScript. There is no frontend framework, build step, or runtime dependency tree.

Created by [@lamps_apple](https://x.com/lamps_apple), creator of [grokify.ai](https://grokify.ai/) and [AppleLamps/grokify](https://github.com/AppleLamps/grokify).

## What It Provides

- Local browser UI for `grok agent stdio`
- One Grok agent process per browser tab session
- Per-tab sessions with `?session=` URLs and local resume state
- Project sidebar grouped by workspace, including local display aliases
- Chat, thinking traces, final answers, todos, plans, permissions, elicitations, and tool activity
- Tool renderers for terminal commands, edits, browser actions, multimodal `read_file`, web and X search, images, videos, scheduler events, subagents, and plan cards
- Manual approval or auto-approval mode for agent tool requests
- Settings for model, agent profile, subagent definitions, effort, sandbox behavior, rules, tool allow-lists, and display name
- Built-in panels for inspect, MCP servers, worktrees, models, memory, hooks, plugins, traces, imports, routines, and headless runs
- File attachment, drag-and-drop, clipboard paste, upload previews, and generated media previews
- Share link support through `grok share`
- Update notice from `grok update --check --json`
- Mobile sidebar drawer for narrow viewports

## Requirements

- Node.js 24 or newer
- `grok` CLI installed and available on `PATH`
- Authenticated Grok account with `grok login`
- Windows, macOS, or Linux

## Quick Start

Clone and run the local server:

```powershell
git clone https://github.com/AppleLamps/grok-build-web.git
cd grok-build-web
npm start
```

The server prints a one-time local URL:

```text
http://127.0.0.1:58991/?token=...
```

Open that URL in your browser. The token is used once to set a local HttpOnly session cookie, then the app redirects to a clean URL.

If you have a wrapper command installed, you can also launch it as:

```powershell
grok --web
```

## Setup

1. Install Node.js 24 or newer.

   ```powershell
   node --version
   ```

2. Install and authenticate the Grok CLI.

   ```powershell
   grok login
   ```

3. Start Grok Build Web.

   ```powershell
   npm start
   ```

4. Choose a workspace from the folder button in the topbar. New sessions start in the selected workspace.

5. Open Settings to choose model, agent profile, subagent definitions, effort, sandbox behavior, rules, approval mode, tool allow-lists, and sidebar display name.

## Daily Use

### Start Or Resume Work

The sidebar groups sessions by workspace. Expand a project to resume a recent session, or use New Chat to start a fresh session in the current workspace.

Each browser tab has its own ACP session ID. Prompts from different tabs can run in parallel, while prompts in the same tab share that tab's agent process and prompt queue.

### Send Prompts

Use the composer at the bottom of the page. `Enter` sends, and `Shift+Enter` inserts a newline.

The send mode selector supports:

- `Interactive`: normal ACP session
- `+ self-check`: headless one-shot with `--check`
- `Best of 3`: headless one-shot with `--best-of-n 3`
- `Best of 5`: headless one-shot with `--best-of-n 5`

Headless modes do not append to the interactive ACP session history.

For more control, Sidebar Tools -> Headless opens a one-shot runner for `grok -p` with `plain`, `json`, or `streaming-json` output, plus new, named, resume, and continue session modes.

### Attach Files

The attach button inserts text-like files into the prompt as fenced code blocks. Other files upload into `.grok-web-uploads` inside the current session workspace and are sent as attached file paths so Grok can read them with its native tools. Drag-and-drop and clipboard paste use the same flow.

Each attach action is capped at 5 files. Text files are capped at 256 KB, and binary uploads default to 25 MB.

Supported text extensions include `.txt`, `.md`, `.js`, `.mjs`, `.ts`, `.tsx`, `.json`, `.css`, `.html`, `.py`, `.sh`, `.ps1`, `.yml`, `.yaml`, `.toml`, `.csv`, `.xml`, and `.log`.

Images support `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, and `.svg`. PDFs support `.pdf`. Audio, video, archives, and other binary formats upload by path; images, PDFs, audio, and video receive browser preview links when their type is recognized.

### Control Approvals

Use the composer approval pill:

- `Auto-approve`: the bridge accepts allowed tool requests automatically
- `Manual approval`: tool requests render as permission cards

### Use Sidebar Tools

The Tools section exposes common Grok CLI and local session actions:

- Inspect config
- MCP servers
- Worktrees
- Models
- Memory
- Routines
- Hooks
- Plugins
- Export trace
- Import sessions
- Headless prompt runner

### Rename Projects Locally

Use the pencil button on a project row in the sidebar to set a local display alias. Aliases are stored in browser `localStorage` and only change what the sidebar shows. They do not rename folders, Grok sessions, or `summary.json` values.

## Configuration

Environment variables read at startup:

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `0` | HTTP port. `0` selects a random free port. |
| `GROK_BIN` | `grok` | Path to the Grok CLI binary. |
| `GROK_BIN_ARGS` | `[]` | Extra Grok CLI prefix args as a JSON array of strings. |
| `GROK_CWD` | `process.cwd()` | Initial workspace directory. |
| `GROK_WEB_USER` | OS username | Default sidebar display name. |
| `GROK_WEB_NO_OPEN` | unset | Set to skip opening the browser automatically. |
| `GROK_WEB_USE_API_KEY` | unset | Set to `1` to keep `XAI_API_KEY` in spawned agent and one-shot CLI environments. |
| `GROK_WEB_SESSIONS_ROOT` | `~/.grok/sessions` | Session directory used for sidebar history and plan hydration. |
| `GROK_MEMORY_ROOT` | `~/.grok/memory` | Memory directory used by the memory panel. |
| `GROK_WEB_MAX_UPLOAD_BYTES` | `26214400` | Maximum binary upload size. |
| `GROK_WEB_MAX_REQUEST_BODY_BYTES` | `67108864` | Maximum JSON request body size. |
| `GROK_WEB_RPC_TIMEOUT_MS` | `120000` | JSON-RPC timeout for non-prompt ACP calls. |
| `GROK_WEB_PROMPT_TIMEOUT_MS` | `1800000` | JSON-RPC timeout for `session/prompt`. |
| `GROK_WEB_PERMISSION_TIMEOUT_MS` | `300000` | Timeout for pending permission cards. |
| `GROK_WEB_ELICITATION_TIMEOUT_MS` | `300000` | Timeout for pending elicitation cards. |
| `GROK_WEB_MAX_ACTIVE_AGENTS` | `4` | Maximum active per-tab agent processes. |
| `GROK_WEB_AGENT_IDLE_MS` | `1800000` | Idle time before an agent process can be evicted. |
| `GROK_WEB_AGENT_IDLE_SWEEP_MS` | `60000` | Agent idle sweep interval. |
| `GROK_WEB_DISABLE_FS_WATCH` | unset | Set to `1` to disable filesystem watching for session changes. |

By default, Grok Build Web strips `XAI_API_KEY` and `GROK_API_KEY` from spawned agent processes and one-shot CLI runs so the CLI uses the cached grok.com login from `~/.grok/auth.json`. Set `GROK_WEB_USE_API_KEY=1` to use API key billing instead.

## Architecture

```text
browser  -> POST /prompt -> server.mjs -> stdin  -> grok agent stdio
browser  <- SSE /stream  <- server.mjs <- stdout <- grok agent stdio
```

The Grok CLI exposes Agent Client Protocol over `grok agent stdio`. `server.mjs` starts a local HTTP server, creates a one-time bootstrap token, and lazily spawns Grok agent children through the bridge.

Each browser tab receives its own ACP `sessionId`, stored in the URL and browser state. The bridge tags events with `sessionId`, so each tab receives only its own stream. Agent processes are lazy-spawned on `/tab/new` or `/tab/load`, reused for prompts in that tab, and evicted after the configured idle period.

The server also shells out to the Grok CLI for non-ACP actions such as inspect, models, MCP servers, worktrees, sharing, traces, imports, update checks, login, and headless one-shot prompts.

## Repository Map

```text
grok-web/
|-- server.mjs                 Thin boot + HTTP listener
|-- lib/                       Bridge modules (ACP, routes, sessions, CLI)
|   |-- grok-bridge.mjs        Multi-agent pool (one stdio child per tab session)
|   |-- agent-connection.mjs   Single ACP stdio child + prompt queue
|   |-- grok-session.mjs       Re-export alias for GrokBridge
|   |-- sessions-store.mjs     Session list + plan.json reads
|   |-- cli-runner.mjs         One-shot grok CLI shell-outs
|   `-- http/
|       |-- router.mjs         Request dispatch
|       `-- routes/            Per-domain HTTP handlers
|-- public/
|   |-- index.html             Page shell
|   |-- styles/
|   |   |-- main.css           Layout, sidebar, composer, settings, modals
|   |   `-- cards.css          Tool, plan, permission, and elicitation cards
|   `-- js/
|       |-- main.js            Browser entry point
|       |-- api.js             Fetch wrappers
|       |-- state.js           Shared client state and DOM refs
|       |-- dispatch.js        SSE event dispatch
|       |-- chat.js            Turn rendering and assistant output
|       |-- tools.js           Barrel re-export for tool rendering
|       |-- tools/             Per-tool renderers + details registry
|       |-- settings.js        Settings panel
|       |-- identity.js        Sidebar identity display
|       |-- sidebar.js         Project drawer and recents
|       |-- composer.js        Input, send, stop, approval mode
|       |-- topbar.js          Workspace picker, share, update notice
|       `-- tools-menu.js      Sidebar tool wiring
|-- package.json
|-- test/                      Fake ACP, renderer, UI-state, bridge, and live integration tests
`-- probe/                     Protocol discovery scripts
```

## HTTP Routes

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Token-gated app shell |
| `/static/*` | GET | Static CSS and JS |
| `/session-media` | GET | Authenticated previews for generated media under Grok session storage |
| `/upload-media` | GET | Authenticated previews for uploaded media under the session workspace |
| `/stream` | GET | SSE stream of agent events |
| `/prompt` | POST | Send an ACP prompt |
| `/cancel` | POST | Cancel the running turn |
| `/upload` | POST | Upload a file into the current session workspace |
| `/settings` | GET, POST | Bridge settings, including auto approve and display name |
| `/identity` | GET | Current sidebar identity |
| `/spawn-opts` | GET | Current launch flags and detected Grok agent capabilities |
| `/sessions` | GET | Recent sessions from the configured sessions root |
| `/session/plan` | GET | Persisted `plan.json` state for a session |
| `/session/new` | POST | Start a new session in a workspace |
| `/session/load` | POST | Load an existing session |
| `/session/respawn` | POST | Restart the agent with new launch flags |
| `/tab/new` | POST | Create a per-tab ACP session |
| `/tab/load` | POST | Load a per-tab ACP session |
| `/permission` | POST | Answer a pending permission request |
| `/elicitation` | POST | Answer a pending elicitation request |
| `/cli/inspect` | GET | `grok inspect --json` |
| `/cli/update-check` | GET | `grok update --check --json` |
| `/cli/models` | GET | `grok models` |
| `/cli/mcp` | GET | `grok mcp list` |
| `/cli/worktree` | GET | `grok worktree list` |
| `/cli/login/status` | GET | Whether `~/.grok/auth.json` exists after device auth |
| `/cli/memory/list` | GET | List Grok memory files under the configured memory root |
| `/cli/memory/read` | GET | Read one Grok memory file, confined to the memory root |
| `/cli/share` | POST | `grok share <sessionId>` |
| `/cli/trace` | POST | `grok trace --local --json` |
| `/cli/login` | POST | `grok login --device-auth` |
| `/cli/oneshot` | POST | Headless `grok -p` for check and best-of-N modes |
| `/cli/headless` | POST | Configurable headless `grok -p` runner |
| `/cli/sessions/search` | POST | Search local Grok sessions |
| `/cli/import` | POST | `grok import --json -- <targets>` |

## Development

Run syntax, lint, and format checks:

```powershell
npm run check
```

Run the account-free regression suite:

```powershell
npm test
```

This uses Node's built-in test runner with fake ACP fixtures. It covers bridge auth and SSE, security headers and local request guards, per-session cwd isolation, API failures, renderer shapes, sidebar/settings behavior, permissions, elicitations, slash commands, bootstrap routing, session edge cases, large output, cancellation, and tool lifecycle state.

Run browser visual smoke checks:

```powershell
npm run test:visual
```

Run live integration checks against the installed `grok` CLI:

```powershell
npm run test:live
```

Live tests start a real local server on an ephemeral port, bootstrap the one-time token, connect SSE, call `/sessions`, `/spawn-opts`, `/cli/models`, `/cli/mcp`, trigger real web search, read generated PNG/JPG/PDF/PPTX fixtures through `read_file`, and verify cancellation recovery. X search and plugin MCP auth are account-dependent opt-in checks:

```powershell
$env:GROK_WEB_LIVE_X_SEARCH='1'; npm run test:live
$env:GROK_WEB_LIVE_PLUGIN_MCP_NAME='<server-name>'; npm run test:live
```

### Grok CLI Compatibility Checks

The local stable updater may target a newer Grok CLI than the public xAI Build changelog. When reviewing a CLI update, verify both `grok update --check --json` and the latest visible changelog entry.

Current items to verify after updating:

- Slash autocomplete wraps with ArrowUp and ArrowDown.
- Session resume replays tool and subagent UI without breaking grouped tool cards.
- Windows image paste and screenshot file input work through browser paste, drag-and-drop, and attach.
- Windows-friendly launch flags are detected from `grok --help`, including `--permission-mode`, `--todo-gate`, `--check`, and `--best-of-n`.
- Multimodal `read_file` output continues rendering text, images, videos, PDFs, and PPTX text.
- Image and video generation previews continue working for URLs and local Grok session media paths, with Open links when a safe URL is available.
- `/login` and `/usage` remain reachable through the web UI or slash autocomplete.
- `--todo-gate` is available in Settings when the installed CLI advertises it.
- `_x.ai/ask_user_question` renders as a web elicitation card and returns `{ outcome, answers?, partial_answers? }`.
- Active TODO state hydrates from persisted `plan.json` when loading a saved session.
- Terminal tool cards continue to update while command output streams.
- Model switching shows an immediate busy status while the agent respawns.
- TUI-only fixes, such as terminal resize handling, terminal video playback, and extension modal keyboard focus, should be validated in the Grok TUI. They do not require a web wrapper change unless the CLI exposes new ACP data or flags.

The compatibility pass should include the existing `npm run test:live` suite, plus manual checks for Windows, Linux, and macOS behaviors where those fixes are platform-specific.

Feature touch points:

- New tool renderer: add a file under `public/js/tools/` and register it in `public/js/tools/details-registry.mjs`.
- New event type: update `public/js/dispatch.js`.
- New permission UI: update `public/js/permissions.js`.
- New elicitation UI: update `public/js/elicitation.js`.
- New launch flag: update `public/js/settings.js` and `lib/grok-session.mjs`.
- New HTTP route: add a handler in `lib/http/routes/` and register it in `lib/http/router.mjs`.
- New CLI panel: update `lib/http/routes/cli.mjs`, `public/js/api.js`, and `public/js/panels.js`.
- Sidebar or layout polish: update `public/styles/main.css`.
- Tool card polish: update `public/styles/cards.css`.

## Security Model

Grok Build Web is designed for local use. The launch URL includes a one-time token that sets an HttpOnly cookie. API and SSE requests require that cookie. Static assets are public because they contain no secrets.

HTTP responses include a local-app security baseline: CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. The server only accepts `Host` values for `127.0.0.1`, `localhost`, or `::1` on its active port. Mutating browser requests with an `Origin` header must come from the same local origin.

The bridge can read and write files only through ACP requests from the agent, and those filesystem handlers are confined to the request's session workspace. Generated media previews are served only through the authenticated `/session-media` endpoint, which is confined to Grok session storage and does not expose arbitrary local files. Uploaded media previews are served only from `.grok-web-uploads` inside the active session workspace.

Per-tab session APIs keep workspace cwd in per-session state so one tab cannot silently change another tab's fallback cwd. Agent restarts and session loads are serialized per agent and through a small bridge operation queue. Permission and elicitation timeout handles are cleared across respawns, and SSE reconnect replay is delivered with response backpressure and listener cleanup.

## Related

- [grokify.ai](https://grokify.ai/)
- [AppleLamps/grokify](https://github.com/AppleLamps/grokify)
- [Known issues](./knownissues.md)
- [Feature backlog](./featurestoadd.md)
