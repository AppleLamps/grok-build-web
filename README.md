# Grok Build Web

Professional local web UI for the `grok` CLI and Grok Build workflows.

[Website](https://grokbuildweb.com/) | [xAI](https://x.ai) | [Agent Client Protocol](https://agentclientprotocol.com/)

Grok Build Web runs on your machine, starts a Grok agent session, and gives you a browser-based workspace for chat, tools, projects, model switching, traces, routines, and session management. It is plain Node, static HTML, CSS, and browser JavaScript. There is no framework, build step, or runtime dependency tree.

Created by [@lamps_apple](https://x.com/lamps_apple), creator of [grokify.ai](https://grokify.ai/) and [AppleLamps/grokify](https://github.com/AppleLamps/grokify).

## Highlights

- Browser chat UI for `grok agent stdio`
- Project sidebar grouped by workspace
- Per-tab sessions with `?session=` URLs
- Tool rendering for terminal, edits, browser actions, multimodal `read_file`, X/web search, images, videos, todos, scheduler, and plan cards
- Manual or auto approval mode
- Settings panel for model, effort, sandbox, rules, tool allow-lists, and display name
- Local project display aliases for screenshot-safe project names
- Built-in panels for inspect, MCP servers, worktrees, models, hooks, plugins, traces, imports, and routines
- Share link support through `grok share`
- Update notice from `grok update --check --json`
- Mobile sidebar drawer

## Quick Start

Requirements:

- Node 24 or newer
- `grok` CLI installed
- Authenticated Grok account with `grok login`
- Windows, macOS, or Linux

Run from the repository:

```powershell
git clone https://github.com/AppleLamps/grok-build-web.git
cd grok-build-web
npm start
```

The server prints a local URL like:

```text
http://127.0.0.1:58991/?token=...
```

Open that URL in your browser. The token is used once to set a local session cookie, then the app redirects to a clean URL.

If you have a wrapper command installed, you can also launch it as:

```powershell
grok --web
```

## Setup

1. Install Node 24+

   Confirm Node is available:

   ```powershell
   node --version
   ```

2. Install and authenticate the Grok CLI

   ```powershell
   grok login
   ```

3. Start Grok Build Web

   ```powershell
   npm start
   ```

4. Pick a workspace

   Use the folder button in the topbar to choose a project path. New sessions start in the selected workspace.

5. Configure the agent

   Open Settings to choose model, effort, sandbox behavior, rules, approval mode, and the sidebar display name.

## Daily Use

### Start or resume work

The sidebar groups sessions by workspace. Expand a project to resume recent sessions, or use New session to start fresh in the current workspace.

### Send prompts

Use the composer at the bottom of the page. `Enter` sends, `Shift+Enter` inserts a newline.

The send mode selector supports:

- `Interactive`: normal ACP session
- `+ self-check`: headless one-shot with `--check`
- `Best of 3`: headless one-shot with `--best-of-n 3`
- `Best of 5`: headless one-shot with `--best-of-n 5`

Headless modes do not append to the interactive ACP session history.

### Attach text files

The attach button inserts text-like files into the prompt as fenced code blocks. Each attach action is capped at 5 files, and each file is capped at 256 KB.

Supported extensions include `.txt`, `.md`, `.js`, `.mjs`, `.ts`, `.tsx`, `.json`, `.css`, `.html`, `.py`, `.sh`, `.ps1`, `.yml`, `.yaml`, `.toml`, `.csv`, `.xml`, and `.log`.

### Control approvals

Use the composer approval pill:

- `Auto-approve`: the bridge accepts allowed tool requests automatically
- `Manual approval`: tool requests render as permission cards

### Use sidebar tools

The Tools section exposes common Grok CLI actions:

- Inspect config
- MCP servers
- Worktrees
- Models
- Routines
- Hooks
- Plugins
- Export trace
- Import sessions

### Change display name

Open Settings, edit Display name, then Apply settings. This changes the sidebar footer immediately and does not restart the agent.

### Rename projects locally

Use the pencil button on a project row in the sidebar to set a local display alias. Aliases are stored in browser `localStorage` and only change what the sidebar shows. They do not rename folders, Grok sessions, or `summary.json` values.

## Configuration

Environment variables read at startup:

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `0` | HTTP port. `0` selects a random free port. |
| `GROK_BIN` | `grok` | Path to the Grok CLI binary. |
| `GROK_CWD` | `process.cwd()` | Initial workspace directory. |
| `GROK_WEB_USER` | OS username | Default sidebar display name. |
| `GROK_WEB_NO_OPEN` | unset | Set to skip opening the browser automatically. |
| `GROK_WEB_USE_API_KEY` | unset | Set to `1` to keep `XAI_API_KEY` in the agent environment. |
| `GROK_WEB_RPC_TIMEOUT_MS` | `120000` | JSON-RPC timeout for non-prompt ACP calls. |
| `GROK_WEB_PROMPT_TIMEOUT_MS` | `1800000` | JSON-RPC timeout for `session/prompt`. |

By default, Grok Build Web strips `XAI_API_KEY` and `GROK_API_KEY` from the spawned agent process so the CLI uses the cached grok.com login from `~/.grok/auth.json`. Set `GROK_WEB_USE_API_KEY=1` to use API key billing instead.

## Architecture

```text
browser  -> POST /prompt -> server.mjs -> stdin  -> grok agent stdio
browser  <- SSE /stream  <- server.mjs <- stdout <- grok agent stdio
```

The Grok CLI exposes Agent Client Protocol over `grok agent stdio`. `server.mjs` lazily spawns one `grok agent stdio` child per browser tab ACP session and bridges ACP messages to the browser through HTTP and Server-Sent Events.

Multiple browser tabs are supported. Each tab keeps its own ACP `sessionId` in the URL and localStorage. The bridge tags events with `sessionId`, so each tab receives only its own stream.

Each tab gets its own agent process, lazy-spawned on `/tab/new` or `/tab/load`. Prompts on different tabs run in parallel; only prompts queued on the same tab share one agent's JSON-RPC pipe. Idle agents are evicted after `GROK_WEB_AGENT_IDLE_MS` (default 30 minutes), capped by `GROK_WEB_MAX_ACTIVE_AGENTS`.

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
| `/stream` | GET | SSE stream of agent events |
| `/prompt` | POST | Send an ACP prompt |
| `/cancel` | POST | Cancel the running turn |
| `/settings` | GET, POST | Bridge settings, including auto approve and display name |
| `/identity` | GET | Current sidebar identity |
| `/spawn-opts` | GET | Current launch flags |
| `/session/respawn` | POST | Restart the agent with new launch flags |
| `/sessions` | GET | Recent sessions from `~/.grok/sessions/` |
| `/tab/new` | POST | Create a per-tab ACP session |
| `/tab/load` | POST | Load a per-tab ACP session |
| `/permission` | POST | Answer a pending permission request |
| `/elicitation` | POST | Answer a pending elicitation request |
| `/cli/inspect` | GET | `grok inspect --json` |
| `/cli/update-check` | GET | `grok update --check --json` |
| `/cli/models` | GET | `grok models` |
| `/cli/mcp` | GET | `grok mcp list` |
| `/cli/worktree` | GET | `grok worktree list` |
| `/cli/share` | POST | `grok share <sessionId>` |
| `/cli/trace` | POST | `grok trace --local --json` |
| `/cli/login` | POST | `grok login --device-auth` |
| `/cli/import` | POST | `grok import --json -- <targets>` |
| `/cli/oneshot` | POST | Headless `grok -p` for check and best-of-N modes |

## Development

Run syntax checks:

```powershell
npm run check
```

Run the account-free regression suite:

```powershell
npm test
```

This uses Node's built-in test runner with fake ACP fixtures. It covers bridge auth and SSE, security headers and local request guards, per-session cwd isolation, API failures, renderer shapes, sidebar/settings behavior, permissions, elicitations, slash commands, bootstrap routing, session edge cases, large output, cancellation, and tool lifecycle state.

Run live integration checks against the installed `grok` CLI:

```powershell
npm run test:live
```

Live tests start a real local server on an ephemeral port, bootstrap the one-time token, connect SSE, call `/sessions`, `/spawn-opts`, `/cli/models`, `/cli/mcp`, trigger real web search, read generated PNG/JPG/PDF/PPTX fixtures through `read_file`, and verify cancellation recovery. X search and plugin MCP auth are account-dependent opt-in checks:

```powershell
$env:GROK_WEB_LIVE_X_SEARCH='1'; npm run test:live
$env:GROK_WEB_LIVE_PLUGIN_MCP_NAME='<server-name>'; npm run test:live
```

### Grok 0.1.218 Compatibility Checks

Grok CLI 0.1.218 ships additional platform and media-generation fixes. Run the automated live suite and manual compatibility checks against the installed CLI after updating.

0.1.218 items to verify:

- Windows Ctrl+X default shortcut help binding
- Linux image pasting and shortcut keybinding behavior
- User-specified duration for video generation
- Temporary screenshot image support on macOS
- Image byte validation that prevents retry loops
- Compaction prompt improvements for training alignment and skill rehydration
- Increased macOS and Linux ulimit handling to avoid ENOSPC failures that can brick the CLI
- Multi-line image links remain non-clickable and no longer break rendering
- `_x.ai/ask_user_question` renders as a web elicitation card and returns `{ outcome, answers?, partial_answers? }`
- Active TODO state hydrates from persisted `plan.json` when loading a saved session

The compatibility pass should include the existing `npm run test:live` suite, plus manual checks for Windows, Linux, and macOS behaviors where those fixes are platform-specific. Review the 0.1.218 release notes in the Grok TUI during the pass.

Feature touch points:

- New tool renderer: add a file under `public/js/tools/` and register it in `public/js/tools/details-registry.mjs`
- New event type: `public/js/dispatch.js`
- New permission UI: `public/js/permissions.js`
- New elicitation UI: `public/js/elicitation.js`
- New launch flag: `public/js/settings.js` and `lib/grok-session.mjs`
- New HTTP route: add a handler in `lib/http/routes/` and register it in `lib/http/router.mjs`
- New CLI panel: `lib/http/routes/cli.mjs`, `public/js/api.js`, and `public/js/panels.js`
- Sidebar or layout polish: `public/styles/main.css`
- Tool card polish: `public/styles/cards.css`

## Security Model

Grok Build Web is designed for local use. The launch URL includes a one-time token that sets an HttpOnly cookie. API and SSE requests require that cookie. Static assets are public because they contain no secrets.

HTTP responses include a local-app security baseline: CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. The server only accepts `Host` values for `127.0.0.1`, `localhost`, or `::1` on its active port. Mutating browser requests with an `Origin` header must come from the same local origin.

The bridge can read and write files only through ACP requests from the agent, and those filesystem handlers are confined to the request's session workspace. Generated media previews are served only through the authenticated `/session-media` endpoint, which is confined to Grok session storage and does not expose arbitrary local files. Per-tab session APIs keep workspace cwd in per-session state so one tab cannot silently change another tab's fallback cwd.

Agent restarts and session loads are serialized per agent and through a small bridge operation queue. Permission and elicitation timeout handles are cleared across respawns, and SSE reconnect replay is delivered with response backpressure and listener cleanup.

## Related

- [grokify.ai](https://grokify.ai/)
- [AppleLamps/grokify](https://github.com/AppleLamps/grokify)
- [Known issues](./knownissues.md)
- [Feature backlog](./featurestoadd.md)
