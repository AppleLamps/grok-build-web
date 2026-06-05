# Known Issues

Live list. Items that get fixed are removed; items get added as they're discovered.

## Operational

- **History replay on SSE connect.** New SSE subscribers receive the full in-memory event history filtered by their sessionId. Replay is backpressure-aware and the cap is 10000 events; older events are dropped.
- **Process cleanup on Ctrl-C is best-effort.** SIGINT kills the child agent, but on Windows orphaned `grok.exe` instances have occasionally been observed if the server crashes. Check `Get-Process grok` if launch fails ("Address already in use" suggests something is squatting the port).
- **Sessions watcher reliability.** `fs.watch` is best-effort across platforms; recursive mode isn't guaranteed on every OS. A silent watcher death stops sidebar auto-refresh — manual refresh still works.

## Edge cases not yet handled

- **`/cli/login` waits for OAuth confirmation.** The device-auth flow needs the user to visit a URL and approve. The current modal shows the prompt text from the CLI but doesn't poll completion — close the modal when done.

## Tests

- **Live account coverage is partly opt-in.** `npm test` uses fake ACP fixtures and does not require a Grok account. `npm run test:live` covers the real CLI, real web search, multimodal `read_file`, and cancellation. X search and plugin MCP auth are implemented as opt-in live checks because account entitlements and configured server names vary by machine.
