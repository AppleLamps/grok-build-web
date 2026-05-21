# Placeholder UI Implementation Plan

## Summary

Wire the remaining placeholder UI controls without adding npm dependencies or a build step:

- Attach button: text/code/markdown file attachments into the composer.
- Mic button: browser speech-to-text into the composer.
- Footer model selector and composer model tag: real model picker using the existing model settings and respawn flow.
- Routines UI: agent-driven scheduler panel using the active Grok session.
- Share button: keep existing behavior, polish states and fallback UX.

## Implementation Steps

1. Attach files
   - Add a client module for the Attach button.
   - Create a hidden multi-file input.
   - Accept only text-like files: `.txt`, `.md`, `.js`, `.mjs`, `.ts`, `.tsx`, `.json`, `.css`, `.html`, `.py`, `.sh`, `.ps1`, `.yml`, `.yaml`, `.toml`, `.csv`, `.xml`, `.log`.
   - Limit each attach action to 5 files and each file to 256 KB.
   - Read files as UTF-8 with `File.text()`.
   - Insert each file into the composer at the cursor as a labeled fenced code block.
   - Show a toast for images, PDFs, audio, video, binaries, and oversized files.

2. Voice input
   - Add a client module for the Mic button.
   - Use `window.SpeechRecognition || window.webkitSpeechRecognition`.
   - Toggle listening state on click.
   - Add a visible recording class and title while recording.
   - Append final transcripts to the composer without auto-sending.
   - Disable or toast when the browser does not support Web Speech.
   - Stop recording state and toast on recognition errors.

3. Model selector
   - Make the sidebar footer model and composer model tag clickable.
   - Reuse `cliModels`, `getSpawnOpts`, and `postRespawn`.
   - Show a compact modal with current model, a model dropdown, Apply, and Cancel.
   - Populate the dropdown from `grok models` plus the existing fallback model IDs.
   - Apply by calling `postRespawn({ model })`.
   - Update both visible model labels after a successful respawn.
   - Keep the Settings panel model field intact.

4. Routines
   - Add a `Routines` item to the sidebar Tools area.
   - Add a modal with List routines, Create routine, and Delete routine actions.
   - Send agent prompts through `postPrompt`.
   - Use `setBusy(true)` and `setStatus('thinking...', 'busy')` so normal turn lifecycle handles output.
   - Keep scheduler tool rendering in `tools.js`.
   - Remove stale documentation that said no top-level Routines button existed.

5. Share polish
   - Give the topbar Share button a stable `id` and `aria-label`.
   - Keep `/cli/share` with the active tab `sessionId`.
   - Disable the button and update the title while sharing.
   - Copy the URL when clipboard access works.
   - Show a modal fallback containing the URL when clipboard access fails.
   - Continue to show toast errors with CLI stderr or exit text.

6. Documentation
   - Update `knownissues.md` to remove fixed placeholder entries.
   - Keep non-text attachment limitations as a current capability note.
   - Update `featurestoadd.md` with done entries.
   - Update `README.md` with attachment, voice, model picker, and Routines behavior.

7. Verification
   - Run `node --check server.mjs`.
   - Run `node --check public/js/*.js`.
   - Verify the app renders in a browser at desktop and mobile widths.
   - Manually exercise attach, voice support/unsupported state, model picker, Routines prompts, and Share fallback where possible.
