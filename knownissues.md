# Known Issues

Live list. Items that get fixed are removed; items get added as they're discovered.

## Tests

- **Live account coverage is partly opt-in.** `npm test` uses fake ACP fixtures and does not require a Grok account. `npm run test:live` covers the real CLI, real web search, multimodal `read_file`, and cancellation. X search and plugin MCP auth are implemented as opt-in live checks because account entitlements and configured server names vary by machine.

## Changelog tracking

- **Public changelog can lag the installed updater.** As of the 2026-06-19 changelog review, the downloaded x.ai changelog documented through Grok Build v0.2.52, while the local stable updater reported and installed v0.2.56. This cleanup did not re-verify the latest version; treat the changelog as backlog input, not the sole source of truth for latest CLI behavior.
- **Changelog-derived candidates need CLI/ACP validation.** New candidates need
  inspection of the installed CLI help, streamed slash commands, ACP events, or
  tool payloads before implementation.

## Regression gaps from changelog review

- **Forked-session transcript retention still needs live artifact coverage.**
  Automated tests now cover oversized bridge replay pruning and fork-session
  replay isolation. Real CLI forked-session transcript preservation still needs
  accessible saved-session artifacts with pre-compaction transcript data.
- **MCP reconnect resilience still needs real plugin-server live coverage.** Automated tests now cover bridge-side concurrent session-load coalescing and undecodable/non-JSON stdio lines. Existing live MCP coverage is still partly opt-in and checks listing/auth presence, not long-running reconnect behavior against a real plugin-managed server.
