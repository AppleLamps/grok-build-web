# Features To Add

This file is now the active backlog only. Shipped feature history lives in
[`completed.md`](./completed.md).

Scope remains **CLI feature parity**: new entries should map to an existing
`grok` capability, flag, slash command, tool, ACP method, or browser-side glue
needed to expose that capability.

Use these status tags:

- `[todo]` — candidate not implemented yet.
- `[blocked]` — blocked by missing CLI/ACP support or unavailable artifacts.
- `[refinement]` — shipped enough for parity, but a focused follow-up would
  improve UX or coverage.
- `[N/A]` — intentionally out of scope.

## Active Backlog

No unimplemented parity items are currently tracked here.

## Refinements

- **[refinement] Scheduler / Routines live status** —
  `[tool scheduler_create / scheduler_delete / scheduler_list]` The routines
  panel supports list/create/delete prompts, but a dedicated live
  scheduled-task status view outside normal turn output would be a polish
  improvement.
- **[refinement] Subagent nesting auto-application** — `[plumbing]` CSS support
  exists for `.tool.subagent-child`; automatically applying it to nested
  `use_tool` spawns remains a focused renderer refinement.
- **[refinement] Worktree launch field clarity** — `[flag --worktree]`
  Worktree behavior is indirectly settable through respawn/rules flows; a
  dedicated Settings field would make it clearer.
- **[refinement] Per-command custom slash UIs** — `[slash /context]`
  `/compact`, `/context`, `/session-info`, `/feedback`, `/imagine`, and
  `/imagine-video` are reachable through autocomplete. Custom browser UI for
  selected commands remains optional polish.

## Live / Artifact-Dependent Follow-Up

- **[blocked] Forked-session transcript retention live proof** — `[plumbing]`
  Automated tests cover bridge replay pruning and fork-session replay isolation.
  Real CLI forked-session transcript preservation still needs accessible
  saved-session artifacts with pre-compaction transcript data.
- **[blocked] Plugin-managed MCP reconnect live proof** — `[plumbing]`
  Automated tests cover bridge-side concurrent session-load coalescing and
  undecodable/non-JSON stdio lines. Long-running reconnect behavior still needs
  validation against a real plugin-managed MCP server.

## Cut From Parity Scope

- Dark-mode toggle.
- Per-cwd pinned sessions.
- Themes per project.
- Generic toasts as a standalone feature.
- Remote/hosted mode.

## Intake Notes

New changelog-derived candidates should be promoted into this file only after
confirming the installed CLI exposes the required flag, slash command, tool
payload, ACP event, session metadata, or local session artifact.
