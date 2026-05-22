# Manual Live Grok Verification

Use this checklist when a live Grok account and current CLI tools are available. The automated tests use fake ACP fixtures because account tools, X search, plugin auth, and multimodal read behavior can vary by environment.

- Start `npm start`, open the token URL, confirm the clean URL loads and SSE reaches `session_ready`.
- Ask for a real web search and inspect the rendered result card.
- Ask for a real X search if enabled for the account and inspect handles, timestamps, links, and snippets.
- Run `read_file` on `.png`, `.jpg`, `.pdf`, and `.pptx` files and inspect multimodal output.
- Start a background command, fetch output, kill it, and confirm status leaves the composer usable.
- Run a subagent task, cancel during execution, and confirm failed/cancelled status renders.
- Open Settings and confirm unsupported launch flags are disabled for the installed CLI.
- Run `grok mcp list` and test a plugin-provided MCP server that requires auth when available.
