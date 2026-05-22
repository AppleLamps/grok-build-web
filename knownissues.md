# Known Issues

Live list. Items that get fixed are removed; items get added as they're discovered.

## Functional gaps

- **Permission mode is mostly binary on the current CLI.** The composer pill toggles between auto-approve and manual approval. Settings includes a guarded `permissionMode` field, but it stays disabled until the installed `grok agent --help` advertises `--permission-mode`.
- **Loading a session whose original cwd was deleted fails.** Agent returns `Path not found.` and the error renders in the log. There's no fallback to "load anyway in current cwd."
- **`/cli/oneshot` (headless `--check` / Best-of-N) requires xAI credits.** Returns a structured error if the account is rate-limited or out of credits. The endpoint's parser surfaces the error to the chat log, but the underlying need to pay is on the user.

## Visual / data quirks

- **Empty-titled sessions** show the folder name instead of a title. Grok generates `generated_title` after a few turns, so freshly-created sessions look bare until they have enough content to summarize.
- **MCP server `ruflo` spawn errors** appear in stderr at every agent startup (`Failed to spawn MCP server 'ruflo': program not found`). User has it configured in `config.toml` but the binary isn't installed. Repeated identical lines are rate-limited, so the first error remains visible without flooding the terminal.
- **Markdown renderer is intentionally small.** Handles bold/italic/inline-code/fenced-code/headings/lists/links and basic pipe tables. Doesn't handle: blockquotes, nested lists, task lists, strikethrough, or syntax highlighting.
- **Browser tool rendering is generic.** Recognizes the call and shows URL/page text, but doesn't render rich previews (screenshots, DOM snapshots) when the agent provides them.

## Operational

- **History replay on SSE connect.** New SSE subscribers receive the full in-memory event history filtered by their sessionId. With long sessions and many tabs the replay cost grows linearly. Cap is 10000 events; older ones are dropped.
- **Process cleanup on Ctrl-C is best-effort.** SIGINT kills the child agent, but on Windows orphaned `grok.exe` instances have occasionally been observed if the server crashes. Check `Get-Process grok` if launch fails ("Address already in use" suggests something is squatting the port).
- **No graceful shutdown of in-flight turns.** Stopping the server mid-prompt drops the response on the floor — the session is persisted by grok itself but the UI never sees the completion.
- **Sessions watcher reliability.** `fs.watch` is best-effort across platforms; recursive mode isn't guaranteed on every OS. A silent watcher death stops sidebar auto-refresh — manual refresh still works.

## Edge cases not yet handled

- **Non-text attachments.** The Attach button supports text-like files only. Images, PDFs, audio, video, binaries, and oversized text files are rejected with a toast because current web prompt wiring sends text prompts only.
- **`/cli/login` waits for OAuth confirmation.** The device-auth flow needs the user to visit a URL and approve. The current modal shows the prompt text from the CLI but doesn't poll completion — close the modal when done.

## Tests

- **Live account coverage is partly opt-in.** `npm test` uses fake ACP fixtures and does not require a Grok account. `npm run test:live` covers the real CLI, real web search, multimodal `read_file`, and cancellation. X search and plugin MCP auth are implemented as opt-in live checks because account entitlements and configured server names vary by machine.
