# Known Issues

Live list. Items that get fixed are removed; items get added as they're discovered.

## Tests

- **Live account coverage is partly opt-in.** `npm test` uses fake ACP fixtures and does not require a Grok account. `npm run test:live` covers the real CLI, real web search, multimodal `read_file`, and cancellation. X search and plugin MCP auth are implemented as opt-in live checks because account entitlements and configured server names vary by machine.

## Changelog tracking

- **Public changelog can lag the installed updater.** The downloaded x.ai changelog currently documents through Grok Build v0.2.52, while the local stable updater reported and installed v0.2.56. Treat the changelog as backlog input, not the sole source of truth for latest CLI behavior.
- **Changelog-derived candidates need CLI/ACP validation.** Items such as
  web-fetch GitHub error guidance, MCP resilience, Windows path cleanliness, and
  large-session replay/fork behavior need inspection of the installed CLI help,
  streamed slash commands, ACP events, or tool payloads before implementation.

## Regression gaps from changelog review

- **Large-session replay and fork behavior are not covered by automated tests.** Public changelog entries mention oversized replay logs and forked sessions retaining full pre-compaction transcripts. Current tests cover SSE replay mechanics, but not very large real session artifacts or forked-session transcript preservation.
- **MCP reconnect and undecodable-stdio resilience are not covered by live tests.** The changelog calls out reconnect flood prevention and stdio servers emitting undecodable lines. Existing live MCP coverage is partly opt-in and checks listing/auth presence, not long-running reconnect behavior.
- **Windows path cleanliness has limited coverage.** The changelog mentions removing `\\?\` prefixes from external tool/model paths and several cross-cwd resume fixes. Existing tests cover Windows HOME fallback and some cwd isolation, but not all displayed/model-facing path forms.
