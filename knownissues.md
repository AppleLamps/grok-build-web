# Known Issues

Live list. Items that get fixed are removed; items get added as they're discovered.

## Functional gaps

- **`/cli/oneshot` (headless `--check` / Best-of-N) requires xAI credits.** Returns a structured error if the account is rate-limited or out of credits. The endpoint's parser surfaces the error to the chat log, but the underlying need to pay is on the user.

## Visual / data quirks

- **Markdown renderer is intentionally small.** Assistant output, plan bodies, and thinking traces share the same safe renderer for bold/italic/inline-code/fenced-code/headings/lists/task lists/links/blockquotes/strikethrough and basic pipe tables. It still doesn't handle nested lists, lazy blockquote continuation, soft line-break preservation, or syntax highlighting.
- **Browser tool rendering is still partial.** URL, action, page text, screenshots, console errors, cookies, DOM/HTML snapshots, and network tables render when the agent provides structured data. Richer browser replay views are still generic text output.

## Operational

- **History replay on SSE connect.** New SSE subscribers receive the full in-memory event history filtered by their sessionId. Replay is backpressure-aware and the cap is 10000 events; older events are dropped.
- **Process cleanup on Ctrl-C is best-effort.** SIGINT kills the child agent, but on Windows orphaned `grok.exe` instances have occasionally been observed if the server crashes. Check `Get-Process grok` if launch fails ("Address already in use" suggests something is squatting the port).
- **Sessions watcher reliability.** `fs.watch` is best-effort across platforms; recursive mode isn't guaranteed on every OS. A silent watcher death stops sidebar auto-refresh — manual refresh still works.

## Edge cases not yet handled

- **Audio / video / other binary attachments.** The Attach button and drag-and-drop accept text files (inline), images (PNG, JPEG, GIF, WEBP, BMP, SVG), and PDFs (up to 25 MB). Audio, video, archives, and other binary formats are still rejected with a toast.
- **`/cli/login` waits for OAuth confirmation.** The device-auth flow needs the user to visit a URL and approve. The current modal shows the prompt text from the CLI but doesn't poll completion — close the modal when done.

## Tests

- **Live account coverage is partly opt-in.** `npm test` uses fake ACP fixtures and does not require a Grok account. `npm run test:live` covers the real CLI, real web search, multimodal `read_file`, and cancellation. X search and plugin MCP auth are implemented as opt-in live checks because account entitlements and configured server names vary by machine.
