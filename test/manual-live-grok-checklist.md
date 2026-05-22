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
