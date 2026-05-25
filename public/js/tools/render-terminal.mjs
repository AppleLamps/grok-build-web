import { ansiToHtml, escapeHTML } from './shared.mjs';

export function renderTerminalDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  if (!raw.command && !out.command) return null;
  const cmd = raw.command ?? out.command ?? '';
  const cwd = out.current_dir ?? raw.cwd ?? '';
  const exit = out.exit_code;
  const timedOut = out.timed_out;
  const truncated = out.truncated;
  const outputText = out.output_for_prompt ?? out.output ?? '';
  const outputHtml = Array.isArray(outputText)
    ? outputText.map(o => ansiToHtml(typeof o === 'string' ? o : (o.text ?? ''))).join('')
    : ansiToHtml(String(outputText));
  const bg = raw.is_background ? '<span class="term-pill bg">background</span>' : '';
  const exitText = escapeHTML(String(exit));
  const exitPill = exit == null ? ''
    : exit === 0 ? `<span class="term-pill ok">exit 0</span>`
    : `<span class="term-pill fail">exit ${exitText}</span>`;
  const truncPill = truncated ? '<span class="term-pill warn">truncated</span>' : '';
  const toPill = timedOut ? '<span class="term-pill fail">timed out</span>' : '';
  return `
    <div class="label">command</div>
    <pre class="term-cmd">${escapeHTML(cmd)}</pre>
    <div class="term-meta">${bg}${exitPill}${truncPill}${toPill}${cwd ? `<span class="term-cwd">cwd: ${escapeHTML(cwd)}</span>` : ''}</div>
    <div class="label">output</div>
    <pre class="term-output">${outputHtml || '<em style="color:var(--mute)">(no output)</em>'}</pre>
  `;
}
